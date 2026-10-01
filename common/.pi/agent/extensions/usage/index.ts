import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { DynamicBorder, getAgentDir, keyHint, rawKeyHint, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { QuotaHttp } from "./http.ts";
import { UsageMenu, renderLoadingStatus, renderStatus, viewsForModel, type UsageUI } from "./menu.ts";
import { PiSubscriptionAuth } from "./pi-auth.ts";
import { ProviderQuotaClient } from "./providers.ts";
import { parseAnthropicEvent, parseCodexUpdate, parseUsageHeaders, record } from "./protocol.ts";
import { SubscriptionUsage } from "./service.ts";
import { FileUsageStore } from "./store.ts";
import type { Provider, Update } from "./domain.ts";

/** Pi's string selector cannot distinguish equal labels. Keep values separate
 * with its standard list components rather than hidden text or visible numbers.
 */
export async function selectLabeled(
  ctx: Pick<ExtensionContext, "mode" | "ui">,
  title: string,
  values: string[],
  labels: string[],
  signal: AbortSignal,
): Promise<string | undefined> {
  if (signal.aborted) return undefined;
  if (values.length !== labels.length || new Set(values).size !== values.length) throw new Error("Invalid reset selector values.");
  if (ctx.mode !== "tui") {
    // RPC only returns visible strings. Do not guess which duplicate it selected.
    if (new Set(labels).size !== labels.length) {
      ctx.ui.notify("Identical reset rows require interactive Pi for safe selection.", "warning");
      return undefined;
    }
    const selected = await ctx.ui.select(title, labels, { signal });
    return !signal.aborted && selected !== undefined ? values[labels.indexOf(selected)] : undefined;
  }
  return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
    const container = new Container();
    const heading = new Text("", 1, 0);
    const hints = new Text("", 1, 0);
    const list = new SelectList(values.map((value, index) => ({ value, label: labels[index] ?? "" })), Math.min(values.length, 12), {
      selectedPrefix: text => theme.fg("accent", text),
      selectedText: text => theme.fg("accent", text),
      description: text => theme.fg("muted", text),
      scrollInfo: text => theme.fg("dim", text),
      noMatch: text => theme.fg("dim", text),
    });
    container.addChild(new DynamicBorder(text => theme.fg("border", text)));
    container.addChild(new Spacer(1));
    container.addChild(heading);
    container.addChild(new Spacer(1));
    container.addChild(list);
    container.addChild(new Spacer(1));
    container.addChild(hints);
    container.addChild(new Spacer(1));
    container.addChild(new DynamicBorder(text => theme.fg("border", text)));
    let finished = false;
    const finish = (value: string | undefined) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      done(signal.aborted ? undefined : value);
    };
    const abort = () => finish(undefined);
    list.onSelect = item => finish(item.value);
    list.onCancel = abort;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) queueMicrotask(abort);
    return {
      render: (width: number) => {
        heading.setText(theme.fg("accent", theme.bold(title)));
        hints.setText(rawKeyHint("↑↓", "navigate") + "  " + keyHint("tui.select.confirm", "select") + "  " + keyHint("tui.select.cancel", "cancel"));
        return container.render(width);
      },
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (finished) return;
        // Preserve the j/k navigation supported by Pi's ordinary selector.
        if (data === "j" || data === "k") {
          const index = values.indexOf(list.getSelectedItem()?.value ?? "");
          list.setSelectedIndex(Math.max(0, Math.min(values.length - 1, index + (data === "j" ? 1 : -1))));
        } else if (keybindings.matches(data, "tui.select.cancel")) abort();
        else list.handleInput(data);
        tui.requestRender();
      },
      dispose: () => { finished = true; signal.removeEventListener("abort", abort); },
    };
  });
}

/** Local subscription dashboard and explicit reset menus for Codex and Claude. */
export default function usageExtension(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  let modelProvider: string | undefined;
  let lifetime = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let animation: ReturnType<typeof setInterval> | undefined;
  let pending = new Map<Provider, number>();
  let frame = 0;
  // Terminals do not expose the browser's reduced-motion preference.
  const motion = process.env.PI_USAGE_REDUCED_MOTION === "1" ? "reduced" : "animated";
  const now = () => Date.now();
  const agentDir = getAgentDir();
  const stateNamespace = createHash("sha256").update(agentDir).digest("hex");
  const auth = new PiSubscriptionAuth(() => context, join(agentDir, "auth.json"));
  const http = new QuotaHttp(fetch, now);
  const clients = {
    codex: new ProviderQuotaClient("codex", auth, http, now),
    anthropic: new ProviderQuotaClient("anthropic", auth, http, now),
  };
  // Do not put runtime state beside a Stow-linked extension or credential file.
  const store = new FileUsageStore(join(homedir(), ".local", "state", "pi-subscription-usage", stateNamespace));
  const usage = new SubscriptionUsage(clients, store, now, randomUUID);
  const menu = new UsageMenu(usage, now);
  const status = () => {
    if (lifetime.signal.aborted || context?.mode !== "tui") return;
    const views = usage.getViews();
    const text = renderStatus(views, now(), modelProvider);
    const waiting = viewsForModel([...pending.keys()].map(provider => ({ provider })), modelProvider).length > 0;
    const loading = text === undefined && waiting ? renderLoadingStatus(modelProvider, frame, motion) : undefined;
    const rendered = text ?? loading;
    context.ui.setStatus("subscription-usage", rendered === undefined ? undefined : context.ui.theme.fg("dim", rendered));
    if (loading && motion === "animated" && !animation) {
      // Match Pi's native loader cadence. Move the block every two spinner frames.
      animation = setInterval(() => { frame++; status(); }, 80);
      animation.unref();
    } else if (!loading && animation) {
      clearInterval(animation);
      animation = undefined;
      frame = 0;
    }
  };
  const ui = (ctx: ExtensionContext): UsageUI => ({
    hasUI: ctx.hasUI,
    select: (title, choices, labels) => labels ? selectLabeled(ctx, title, choices, labels, lifetime.signal) : ctx.ui.select(title, choices, { signal: lifetime.signal }),
    confirm: (title, message) => ctx.ui.confirm(title, message, { signal: lifetime.signal }),
    notify: (message, severity) => { if (ctx.hasUI) ctx.ui.notify(message, severity); else console.log(message); },
  });
  const refresh = async (ctx: ExtensionContext) => {
    context = ctx;
    const current = lifetime;
    if (current.signal.aborted) return;
    const active = pending;
    const providers = ["codex", "anthropic"] as const;
    for (const provider of providers) active.set(provider, (active.get(provider) ?? 0) + 1);
    status();
    await Promise.all(providers.map(async provider => {
      try { await usage.refresh(provider, current.signal); }
      finally {
        const count = (active.get(provider) ?? 1) - 1;
        if (count > 0) active.set(provider, count);
        else active.delete(provider);
        // Publish each provider independently. A slow second provider cannot hold the footer.
        if (current === lifetime && !current.signal.aborted) status();
      }
    }));
  };
  const stop = () => {
    lifetime.abort();
    if (timer) clearInterval(timer);
    if (animation) clearInterval(animation);
    timer = undefined;
    animation = undefined;
    pending = new Map();
    frame = 0;
    context?.ui.setStatus("subscription-usage", undefined);
  };
  const refreshInBackground = (ctx: ExtensionContext) => {
    const current = lifetime;
    void refresh(ctx).catch(() => {
      if (current === lifetime && !current.signal.aborted) ctx.ui.notify("Unexpected subscription monitor failure.", "error");
    });
  };

  pi.registerCommand("usage", {
    description: "Subscription usage",
    handler: async (args, ctx) => {
      context = ctx;
      modelProvider = ctx.model?.provider;
      if (args.trim()) {
        ui(ctx).notify("Use /usage without arguments.", "warning");
        return;
      }
      await menu.open(ui(ctx), lifetime.signal, modelProvider);
      status();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    stop();
    lifetime = new AbortController();
    context = ctx;
    modelProvider = ctx.model?.provider;
    // Non-interactive sessions have no automatic quota traffic or long-lived timer.
    if (ctx.mode !== "tui") return;
    refreshInBackground(ctx);
    timer = setInterval(() => {
      if (context) refreshInBackground(context);
    }, 5 * 60_000);
    timer.unref();
  });
  pi.on("session_shutdown", stop);
  pi.on("agent_start", () => usage.beginTurn());
  pi.on("model_select", (event, ctx) => {
    context = ctx;
    modelProvider = event.model.provider;
    // Hide the previous provider immediately, even while the refresh is pending.
    status();
    if (ctx.mode === "tui") refreshInBackground(ctx);
  });

  const ingest = async (provider: Provider, update: Update, ctx: ExtensionContext) => {
    if (lifetime.signal.aborted || ctx.mode !== "tui") return;
    context = ctx;
    // Never assign telemetry from a previous login to the displayed account.
    const current = lifetime;
    const account = await clients[provider].discover(current.signal);
    if (current !== lifetime || current.signal.aborted) return;
    const shown = usage.getViews().find(v => v.provider === provider);
    if (!account.ok || account.value.key !== shown?.account?.key) return;
    const warning = usage.apply(provider, update);
    if (warning && ctx.hasUI && viewsForModel(usage.getViews(), modelProvider).some(view => view.provider === provider)) ctx.ui.notify(warning, "warning");
    status();
  };
  pi.on("provider_stream_event", async (event, ctx) => {
    if (event.provider === "anthropic") {
      const previous = usage.getViews().find(v => v.provider === "anthropic")?.snapshot;
      const update = parseAnthropicEvent(event.data, previous);
      if (update) await ingest("anthropic", update, ctx);
    } else if (event.provider === "openai-codex") {
      const raw = record(event.data);
      if (raw?.method !== "account/rateLimits/updated") return;
      const update = parseCodexUpdate(raw.params);
      if (update) await ingest("codex", update, ctx);
    }
  });
  pi.on("after_provider_response", async (event, ctx) => {
    // This older hook lacks a provider identity. Restrict it to the selected native
    // subscription provider and its family-specific headers; never infer from 429.
    const provider = ctx.model?.provider === "anthropic" ? "anthropic" : ctx.model?.provider === "openai-codex" ? "codex" : undefined;
    if (!provider) return;
    const update = parseUsageHeaders(provider, event.headers, now());
    if (update) await ingest(provider, update, ctx);
  });
}
