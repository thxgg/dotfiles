import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DISCOVER_EVENT, RENDER_EVENT, type RenderRequest } from "./adapter.ts";
import { registerLocalTools } from "./builtins.ts";
import { InvalidVerbosityError, loadVerbosity, parseVerbosity, persistVerbosity, statePath, VerbosityStateError, watchVerbosity, type Verbosity } from "./config.ts";
import { Activity, type Content } from "./model.ts";
import { BOUNDARY_ENTRY, OUTSIDE_ENTRY, reconstruct } from "./rebuild.ts";
import { activityComponent } from "./render.ts";

type ModeState =
  | { readonly kind: "inactive" }
  | { readonly kind: "invalid"; readonly error: InvalidVerbosityError }
  | { readonly kind: "ready"; readonly verbosity: Verbosity };

/** Register the globally synchronized renderer. Resolve CLI selection only at session_start. */
export default function verbosityLevel(pi: ExtensionAPI): void {
  pi.registerFlag("verbosity", {
    description: "Save global tool display: low (grouped) or default (native)",
    type: "string",
  });
  // CLI extension flags are applied after factories run. An explicit process option
  // is needed here because Pi also rebuilds historical rows before session_start.
  const eager = process.env.PI_VERBOSITY_BUILTINS !== "0";
  const supported = new Set<string>();
  let activity = new Activity(supported);
  let mode: ModeState = { kind: "inactive" };
  const isEnabled = () => mode.kind === "ready" && mode.verbosity === "low";
  let terminal = false;
  let preferencePath: string | undefined;
  let stopWatching: (() => void) | undefined;
  let cliApplied = false;
  let animation: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let lastEntry: string | undefined;
  const invalidators = new Map<string, () => void>();
  let streamedParts: Set<number> | undefined;
  const streamAssistant = (message: { content: readonly { type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }[] }, ctx: ExtensionContext) => {
    message.content.forEach((part, index) => {
      if (streamedParts?.has(index)) return;
      if (part.type === "thinking" || (part.type === "text" && part.text?.trim())) {
        activity.boundary();
        streamedParts?.add(index);
      } else if (part.type === "toolCall" && part.id && part.name) {
        reconcileBoundaries(ctx);
        activity.add(part.id, part.name, part.arguments ?? {});
        refreshCall(part.id);
        streamedParts?.add(index);
      }
    });
  };
  const redraw = () => { for (const invalidate of [...invalidators.values()]) invalidate(); };
  const refreshCall = (id: string) => {
    invalidators.get(id)?.();
    const call = activity.calls.get(id);
    if (call) {
      const group = activity.group(call.group);
      const host = group && activity.members(group)[0];
      if (host && host.id !== id) invalidators.get(host.id)?.();
    }
  };
  const disposeRender = pi.events.on(RENDER_EVENT, value => {
    const request = value as RenderRequest;
    if (disposed || !request?.context) return;
    invalidators.set(request.context.toolCallId, request.context.invalidate);
    // Resolve the current model on render: /reload constructs rows before session_start.
    request.component = {
      invalidate() {},
      render(width) { return activityComponent(activity, request, () => terminal && isEnabled() && supported.has(request.name), id => invalidators.has(id)).render(width); },
      handleMouse(event) {
        const result = activityComponent(activity, request, () => terminal && isEnabled() && supported.has(request.name), id => invalidators.has(id)).handleMouse?.(event);
        if (result?.handled) redraw();
        return result;
      },
    };
  });
  const rebuild = (ctx: ExtensionContext, keepRows = false) => {
    if (!keepRows) invalidators.clear();
    activity = reconstruct(ctx.sessionManager.buildContextEntries(), supported);
    lastEntry = ctx.sessionManager.getLeafId() ?? undefined;
    streamedParts = undefined;
  };
  const reconcileBoundaries = (ctx: ExtensionContext) => {
    if ((ctx.sessionManager.getLeafId() ?? undefined) === lastEntry) return;
    const entries = ctx.sessionManager.getBranch();
    const previous = entries.findIndex(entry => entry.id === lastEntry);
    for (const entry of entries.slice(previous + 1)) {
      if (entry.type === "custom" || (entry.type === "custom_message" && entry.display) || entry.type === "branch_summary") activity.boundary();
    }
    lastEntry = entries.at(-1)?.id;
  };
  const syncVerbosity = (ctx: ExtensionContext) => {
    if (mode.kind !== "ready" || !preferencePath) return;
    const saved = loadVerbosity(preferencePath);
    if (saved instanceof VerbosityStateError) {
      ctx.ui.notify(saved.message, "error");
      return; // Keep the last known mode on read failure or file removal.
    }
    if (saved !== undefined && saved !== mode.verbosity) {
      mode = { kind: "ready", verbosity: saved };
      redraw();
    }
  };
  const localNames = eager ? registerLocalTools(pi) : [];
  pi.on("session_start", async (event, ctx) => {
    stopWatching?.();
    stopWatching = undefined;
    if (animation) clearInterval(animation);
    animation = undefined;
    terminal = false;
    mode = { kind: "inactive" };
    const selection = parseVerbosity(pi.getFlag("verbosity"));
    if (selection instanceof InvalidVerbosityError) {
      mode = { kind: "invalid", error: selection };
      if (ctx.hasUI) ctx.ui.notify(selection.message, "error");
      else console.error(selection.message);
      redraw();
      return;
    }
    if (ctx.mode !== "tui") return; // No terminal UI or state I/O in RPC/print/JSON.
    preferencePath = statePath();
    const saved = loadVerbosity(preferencePath);
    if (saved instanceof VerbosityStateError) ctx.ui.notify(saved.message, "error");
    mode = { kind: "ready", verbosity: saved instanceof VerbosityStateError ? "default" : saved ?? "low" };
    // Reload creates a fresh factory but must not replay an old CLI choice.
    if (!cliApplied && event.reason === "startup" && selection !== undefined) {
      const error = persistVerbosity(selection, preferencePath);
      if (error) ctx.ui.notify(error.message, "error");
      else mode = { kind: "ready", verbosity: selection };
    }
    cliApplied = true;
    terminal = true;
    stopWatching = watchVerbosity(preferencePath, () => syncVerbosity(ctx));
    animation = setInterval(() => {
      if (isEnabled() && [...activity.calls.values()].some(call => call.status === "running" || call.status === "queued")) redraw();
    }, 80);
    animation.unref();
    supported.clear();
    for (const tool of pi.getAllTools()) {
      if (!localNames.includes(tool.name)) continue;
      try {
        if (realpathSync(tool.sourceInfo.path) === realpathSync(fileURLToPath(import.meta.url))) supported.add(tool.name);
      } catch { /* Unknown or competing owner: normal rows. */ }
    }
    // Owners respond synchronously through the documented shared event bus.
    const discovery = { names: new Set<string>() };
    pi.events.emit(DISCOVER_EVENT, discovery);
    for (const name of discovery.names) supported.add(name);
    rebuild(ctx, true);
    redraw();
  });
  pi.on("session_tree", (_event, ctx) => { if (terminal) rebuild(ctx); });
  pi.on("session_compact", (_event, ctx) => { if (terminal) rebuild(ctx); });
  pi.on("message_start", (event, ctx) => {
    if (!terminal) return;
    if (event.message.role === "assistant") { reconcileBoundaries(ctx); streamedParts = new Set(); }
    else if (event.message.role !== "toolResult") activity.message(event.message);
  });
  pi.on("message_update", (event, ctx) => {
    if (!terminal || event.message.role !== "assistant") return;
    streamAssistant(event.message, ctx);
  });
  pi.on("message_end", (event, ctx) => {
    if (!terminal) return;
    if (event.message.role === "assistant" && streamedParts) {
      streamAssistant(event.message, ctx);
      streamedParts = undefined;
    } else activity.message(event.message);
    if (event.message.role === "toolResult") refreshCall(event.message.toolCallId);
  });
  pi.on("tool_execution_start", event => {
    // Nested calls have no transcript rows. The parent (for example codemode) owns their display.
    if (!terminal || event.parentToolCallId) return;
    activity.start(event.toolCallId, event.toolName, event.args);
    refreshCall(event.toolCallId);
  });
  pi.on("tool_execution_update", event => {
    if (!terminal || event.parentToolCallId) return;
    // No partial-result copies. Native renderers still receive all progress updates.
    if (event.partialResult.content.some((p: Content) => p.type === "image")) { activity.exclude(event.toolCallId); redraw(); }
    else refreshCall(event.toolCallId);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (!terminal || event.parentToolCallId) return;
    activity.finish(event.toolCallId, { ...event.result, isError: event.isError }, ctx.signal?.aborted);
    if (event.result.content.some((p: Content) => p.type === "image")) redraw();
    else refreshCall(event.toolCallId);
  });
  pi.on("ui_prompt_start", () => {
    if (!terminal) return;
    const ids = activity.prompt();
    // One display-only entry per prompt boundary, never per progress update.
    if (ids.length) pi.appendEntry(OUTSIDE_ENTRY, ids);
    else pi.appendEntry(BOUNDARY_ENTRY);
    redraw();
  });
  pi.on("user_bash", () => { if (terminal) activity.boundary(); });
  pi.on("agent_settled", () => { if (terminal) { activity.settle(); redraw(); } });
  pi.on("session_shutdown", () => {
    stopWatching?.();
    stopWatching = undefined;
    disposed = true;
    if (animation) clearInterval(animation);
    animation = undefined;
    terminal = false;
    mode = { kind: "inactive" };
    disposeRender();
    invalidators.clear();
    activity = new Activity(supported);
  });
  const changeVerbosity = (verbosity: Verbosity, ctx: ExtensionContext) => {
    if (mode.kind !== "ready" || !preferencePath) return false;
    const error = persistVerbosity(verbosity, preferencePath);
    if (error) {
      ctx.ui.notify(error.message, "error");
      return false;
    }
    mode = { kind: "ready", verbosity };
    redraw();
    return true;
  };
  const commandReady = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return false;
    if (mode.kind === "ready") return true;
    ctx.ui.notify(mode.kind === "invalid" ? mode.error.message : "Verbosity is not active. Wait for session_start.", "error");
    return false;
  };
  pi.registerCommand("verbosity", {
    description: "Set global persistent tool display: low, default, status",
    getArgumentCompletions(prefix) {
      return ["low", "default"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
    },
    async handler(args, ctx) {
      if (!commandReady(ctx)) return;
      const action = args.trim() || "status";
      if (action === "low" || action === "default") {
        if (!changeVerbosity(action, ctx)) return;
      } else if (action === "status") syncVerbosity(ctx);
      else {
        ctx.ui.notify("Use /verbosity low|default|status", "error");
        return;
      }
      ctx.ui.notify(`Verbosity ${isEnabled() ? "low" : "default"}. Global preference; changes sync across open Pi sessions and persist across restarts.\nSupported: ${[...supported].join(", ") || "none"}. Standard-local tools only. Set PI_VERBOSITY_BUILTINS=0 with remote or SDK overrides.`, "info");
    },
  });
}
