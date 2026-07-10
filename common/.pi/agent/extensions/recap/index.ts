import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, persistEnabled, type RecapConfig } from "./config.ts";
import {
  createHerdrFocusMonitor,
  disableTerminalFocusReporting,
  enableTerminalFocusReporting,
  TerminalFocusParser,
  type FocusMonitor,
} from "./focus.ts";
import { generateSummary } from "./summary.ts";
import { clearWidget, showWidget } from "./widget.ts";

const CUSTOM_TYPE = "session-recap";
const STATUS_KEY = "session-recap";

type RecapData = {
  version: 2;
  action: "set" | "clear";
  text?: string;
  key?: string;
  source?: "auto" | "manual";
  updatedAt: string;
};

type RecapState = { text?: string; key?: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function replay(entries: SessionEntry[]): RecapState {
  const state: RecapState = {};
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
    const data = record(entry.data);
    if (data?.action === "clear") {
      state.text = undefined;
      state.key = undefined;
    } else if (data?.action === "set" && typeof data.text === "string") {
      state.text = data.text;
      state.key = typeof data.key === "string" ? data.key : undefined;
    }
  }
  return state;
}

export function latestUserTurn(entries: SessionEntry[]): { key?: string; count: number } {
  let key: string | undefined;
  let count = 0;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    key = entry.id;
    count += 1;
  }
  return { key, count };
}

function currentUserTurn(ctx: ExtensionContext): { key?: string; count: number } {
  return latestUserTurn(ctx.sessionManager.getBranch());
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && /abort/i.test(error.message);
}

export default function recapExtension(pi: ExtensionAPI): void {
  let active = false;
  let focused = true;
  let settled = false;
  let config: RecapConfig | undefined;
  let state: RecapState = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation: AbortController | undefined;
  let focusMonitor: FocusMonitor | undefined;
  let unsubscribeInput: (() => void) | undefined;
  let terminalReporting = false;
  let blurredAt: number | undefined;
  let sequence = 0;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const abortGeneration = () => {
    generation?.abort();
    generation = undefined;
  };

  const cancel = () => {
    clearTimer();
    abortGeneration();
  };

  const append = (data: Omit<RecapData, "version" | "updatedAt">) => {
    pi.appendEntry<RecapData>(CUSTOM_TYPE, { version: 2, updatedAt: new Date().toISOString(), ...data });
  };

  const syncWidget = (ctx: ExtensionContext) => {
    if (active && config?.enabled && state.text) showWidget(ctx, state.text);
    else clearWidget(ctx);
  };

  const run = async (ctx: ExtensionContext, source: "auto" | "manual", force = false) => {
    if (!active || !config?.enabled || ctx.mode !== "tui") return;
    if (source === "auto" && (focused || !settled || !ctx.isIdle())) return;
    const turn = currentUserTurn(ctx);
    if (!turn.key || (!force && (state.key === turn.key || turn.count < config.minTurns))) return;

    cancel();
    const controller = new AbortController();
    const runId = ++sequence;
    generation = controller;
    if (source === "manual") ctx.ui.setStatus(STATUS_KEY, "recap…");

    try {
      const text = await generateSummary(ctx, config, controller.signal);
      if (!active || runId !== sequence || controller.signal.aborted) return;
      if (currentUserTurn(ctx).key !== turn.key) return;
      state = { text, key: turn.key };
      append({ action: "set", text, key: turn.key, source });
      showWidget(ctx, text);
    } catch (error) {
      if (!isAbort(error) && source === "manual") {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    } finally {
      if (generation === controller) generation = undefined;
      if (source === "manual") ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  };

  const schedule = (ctx: ExtensionContext) => {
    if (!active || focused || !settled || !config?.enabled || !config.auto) return;
    const turn = currentUserTurn(ctx);
    if (!turn.key || state.key === turn.key || turn.count < config.minTurns) return;
    if (timer || generation) return;
    const elapsed = blurredAt === undefined ? 0 : Date.now() - blurredAt;
    timer = setTimeout(() => {
      timer = undefined;
      void run(ctx, "auto");
    }, Math.max(0, config.debounceMs - elapsed));
    timer.unref?.();
  };

  const setFocused = (ctx: ExtensionContext, value: boolean) => {
    if (focused === value) return;
    focused = value;
    if (focused) {
      blurredAt = undefined;
      clearTimer();
      abortGeneration();
      syncWidget(ctx);
    } else {
      blurredAt = Date.now();
      schedule(ctx);
    }
  };

  const installFocus = (ctx: ExtensionContext) => {
    focusMonitor = createHerdrFocusMonitor((value) => setFocused(ctx, value));
    if (focusMonitor) return;

    terminalReporting = true;
    const parser = new TerminalFocusParser();
    enableTerminalFocusReporting();
    unsubscribeInput = ctx.ui.onTerminalInput((input) => {
      const parsed = parser.push(input);
      if (typeof parsed.focused === "boolean") setFocused(ctx, parsed.focused);
      if (parsed.data === input) return undefined;
      return parsed.data ? { data: parsed.data } : { consume: true };
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    cancel();
    active = ctx.mode === "tui";
    settled = ctx.isIdle();
    focused = true;
    blurredAt = undefined;
    state = replay(ctx.sessionManager.getBranch());
    config = await loadConfig(ctx);
    syncWidget(ctx);
    if (active && config.enabled && config.auto) installFocus(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    active = false;
    cancel();
    focusMonitor?.dispose();
    focusMonitor = undefined;
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    if (terminalReporting) disableTerminalFocusReporting();
    terminalReporting = false;
    clearWidget(ctx);
  });

  pi.on("input", () => {
    settled = false;
    cancel();
  });
  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "user" || (!state.text && !state.key)) return;
    state = {};
    append({ action: "clear" });
    clearWidget(ctx);
  });
  pi.on("agent_start", () => {
    settled = false;
    cancel();
  });
  pi.on("agent_settled", (_event, ctx) => {
    settled = true;
    schedule(ctx);
  });

  const reloadSessionState = async (ctx: ExtensionContext) => {
    cancel();
    state = replay(ctx.sessionManager.getBranch());
    config = await loadConfig(ctx);
    syncWidget(ctx);
  };
  pi.on("session_tree", async (_event, ctx) => reloadSessionState(ctx));
  pi.on("session_compact", async (_event, ctx) => reloadSessionState(ctx));

  pi.registerCommand("recap", {
    description: "Show, refresh, or disable the session recap",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") return;
      await ctx.waitForIdle();
      config ??= await loadConfig(ctx);
      const action = args.trim().toLowerCase();

      if (["off", "disable", "hide"].includes(action)) {
        cancel();
        focusMonitor?.dispose();
        focusMonitor = undefined;
        unsubscribeInput?.();
        unsubscribeInput = undefined;
        if (terminalReporting) disableTerminalFocusReporting();
        terminalReporting = false;
        await persistEnabled(false);
        config.enabled = false;
        clearWidget(ctx);
        ctx.ui.notify("Session recap off globally", "info");
        return;
      }
      if (action === "clear") {
        state = {};
        append({ action: "clear" });
        clearWidget(ctx);
        return;
      }
      if (action && !["on", "enable", "show", "refresh", "now", "update"].includes(action)) {
        ctx.ui.notify("Usage: /recap [on|off|clear|refresh]", "warning");
        return;
      }
      if (!config.enabled) {
        await persistEnabled(true);
        config.enabled = true;
        if (!focusMonitor && !unsubscribeInput) installFocus(ctx);
      }
      await run(ctx, "manual", true);
    },
  });
}
