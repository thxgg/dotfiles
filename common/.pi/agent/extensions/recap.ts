/**
 * /recap
 *
 * One-line sticky session recap above the editor. The on/off toggle is stored
 * globally in .pi/agent/.cache/session-recap/state.json. Auto mode enables
 * terminal focus events (DECSET ?1004h) and generates only after a completed
 * turn, an unfocused terminal, the inactivity delay, and a blank editor.
 */
import { complete, type Api, type Model, type UserMessage } from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  convertToLlm,
  getAgentDir,
  serializeConversation,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import fs from "node:fs/promises";
import path from "node:path";

const WIDGET_KEY = "session-recap";
const STATUS_KEY = "session-recap";
const CUSTOM_TYPE = "session-recap";
const WIDGET_PADDING = "  ";

const ENABLE_FOCUS_EVENTS = "\x1b[?1004h";
const DISABLE_FOCUS_EVENTS = "\x1b[?1004l";
const FOCUS_EVENT_PATTERN = /\x1b\[(I|O)/g;

type RecapSource = "manual" | "auto";
type RecapEntryAction = "set" | "clear" | "enable" | "disable";

type RecapConfig = {
  enabled: boolean;
  auto: boolean;
  inactivityMs: number;
  minTurns: number;
  maxChars: number;
  maxInputChars: number;
  model: string;
};

type RecapState = {
  enabled: boolean;
  text?: string;
  key?: string;
  updatedAt?: string;
};

type GlobalRecapState = {
  enabled?: boolean;
  updatedAt?: string;
};

type RecapEntryData = {
  type: typeof CUSTOM_TYPE;
  version: 1;
  action: RecapEntryAction;
  enabled?: boolean;
  text?: string;
  key?: string;
  source?: RecapSource | "command";
  updatedAt: string;
};

type BranchStats = {
  key: string;
  messageCount: number;
  userTurns: number;
  relevantCount: number;
  lastRelevantEntryId: string;
};

type ActiveGeneration = {
  id: number;
  source: RecapSource;
  key: string;
  controller: AbortController;
};

type LastCompletedTurn = {
  completedAt: number;
  stats: BranchStats;
};

const DEFAULT_CONFIG: RecapConfig = {
  enabled: true,
  auto: true,
  inactivityMs: 180_000,
  minTurns: 3,
  maxChars: 180,
  maxInputChars: 120_000,
  model: "current",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function applyRecapSettings(config: RecapConfig, raw: unknown): RecapConfig {
  if (!isRecord(raw)) return config;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : config.enabled,
    auto: typeof raw.auto === "boolean" ? raw.auto : config.auto,
    inactivityMs: clampNumber(raw.inactivityMs, config.inactivityMs, 0, 24 * 60 * 60 * 1000),
    minTurns: clampNumber(raw.minTurns, config.minTurns, 0, 100),
    maxChars: clampNumber(raw.maxChars, config.maxChars, 40, 1000),
    maxInputChars: clampNumber(raw.maxInputChars, config.maxInputChars, 4_000, 1_000_000),
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : config.model,
  };
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function getGlobalStatePath(): string {
  return path.join(getAgentDir(), ".cache", "session-recap", "state.json");
}

async function loadGlobalRecapState(): Promise<GlobalRecapState> {
  const raw = await readJsonObject(getGlobalStatePath());
  if (!raw) return {};

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

async function writeGlobalRecapState(state: GlobalRecapState): Promise<void> {
  const statePath = getGlobalStatePath();
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, statePath);
}

async function writeGlobalRecapEnabled(enabled: boolean): Promise<void> {
  await writeGlobalRecapState({ enabled, updatedAt: nowIso() });
}

async function loadRecapConfig(ctx: ExtensionContext): Promise<RecapConfig> {
  let config = { ...DEFAULT_CONFIG };

  const globalSettings = await readJsonObject(path.join(getAgentDir(), "settings.json"));
  config = applyRecapSettings(config, globalSettings?.recap);

  if (ctx.isProjectTrusted()) {
    const projectSettings = await readJsonObject(path.join(ctx.cwd, ".pi", "settings.json"));
    config = applyRecapSettings(config, projectSettings?.recap);
  }

  const globalState = await loadGlobalRecapState();
  if (typeof globalState.enabled === "boolean") {
    config.enabled = globalState.enabled;
  }

  return config;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getEditorText(ctx: ExtensionContext): string {
  if (!ctx.hasUI) return "";
  try {
    return ctx.ui.getEditorText() ?? "";
  } catch {
    return "";
  }
}

function editorIsBlank(ctx: ExtensionContext): boolean {
  return getEditorText(ctx).trim().length === 0;
}

function isRelevantContextEntry(entry: SessionEntry): boolean {
  return (
    entry.type === "message" ||
    entry.type === "custom_message" ||
    entry.type === "branch_summary" ||
    entry.type === "compaction"
  );
}

function getBranchStats(ctx: ExtensionContext): BranchStats {
  const branch = ctx.sessionManager.getBranch();
  const sessionId = ctx.sessionManager.getSessionId();
  let messageCount = 0;
  let userTurns = 0;
  let relevantCount = 0;
  let lastRelevantEntryId = "root";

  for (const entry of branch) {
    if (entry.type === "message") {
      messageCount += 1;
      if ((entry.message as { role?: string }).role === "user") {
        userTurns += 1;
      }
    }

    if (isRelevantContextEntry(entry)) {
      relevantCount += 1;
      lastRelevantEntryId = entry.id;
    }
  }

  return {
    key: [sessionId, lastRelevantEntryId, relevantCount, messageCount, userTurns].join(":"),
    messageCount,
    userTurns,
    relevantCount,
    lastRelevantEntryId,
  };
}

function truncateConversationText(text: string, maxInputChars: number): string {
  if (text.length <= maxInputChars) return text;

  const marker = "\n\n[Earlier middle transcript omitted for recap input.]\n\n";
  const headChars = Math.min(12_000, Math.floor(maxInputChars * 0.2));
  const tailChars = Math.max(1, maxInputChars - headChars - marker.length);

  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

function buildConversationText(ctx: ExtensionContext, maxInputChars: number): string {
  const sessionContext = buildSessionContext(
    ctx.sessionManager.getEntries(),
    ctx.sessionManager.getLeafId(),
  );
  const llmMessages = convertToLlm(sessionContext.messages);
  const serialized = serializeConversation(llmMessages).trim();
  return truncateConversationText(serialized, maxInputChars).trim();
}

function buildSystemPrompt(maxChars: number): string {
  return [
    `Summarize the current coding session in one line, <= ${maxChars} chars.`,
    "Include: current goal, progress, blocker, and next action if known.",
    "No markdown. No preamble. Do not mention \"the conversation\".",
    "Do not answer questions or continue the transcript.",
  ].join("\n");
}

function buildUserPrompt(conversationText: string): string {
  return [
    "Summarize this coding-session transcript for a returning user.",
    "",
    "<transcript>",
    conversationText,
    "</transcript>",
  ].join("\n");
}

function normalizeRecapText(text: string, maxChars: number): string {
  let normalized = text
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```(?:\w+)?|```/g, ""))
    .replace(/\s+/g, " ")
    .replace(/^[-*•]\s*/, "")
    .replace(/^recap:\s*/i, "")
    .trim();

  normalized = normalized.replace(/^["'`]+|["'`]+$/g, "").trim();

  if (normalized.length > maxChars) {
    normalized = `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }

  return normalized;
}

function getTextParts(content: Array<{ type: string; text?: string }>): string[] {
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text);
}

function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  const message = (error as { message?: unknown }).message;
  return name === "AbortError" || (typeof message === "string" && /aborted|abort/i.test(message));
}

function notifyManual(ctx: ExtensionContext, source: RecapSource, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (source === "manual" && ctx.hasUI) {
    ctx.ui.notify(message, type);
  }
}

function showRecapWidget(ctx: ExtensionContext, text: string): void {
  ctx.ui.setWidget(
    WIDGET_KEY,
    (_tui, theme) => ({
      render(width: number): string[] {
        const line = truncateToWidth(`${WIDGET_PADDING}recap: ${text}`, Math.max(1, width), "…");
        return [theme.fg("dim", line)];
      },
      invalidate(): void {
        // No cached render state.
      },
    }),
    { placement: "aboveEditor" },
  );
}

function clearRecapWidget(ctx: ExtensionContext): void {
  if (ctx.hasUI) {
    ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
  }
}

function writeTerminalControl(sequence: string): void {
  try {
    if (!process.stdout.isTTY) return;
    process.stdout.write(sequence);
  } catch {
    // Best-effort terminal control only.
  }
}

function enableTerminalFocusEvents(): void {
  writeTerminalControl(ENABLE_FOCUS_EVENTS);
}

function disableTerminalFocusEvents(): void {
  writeTerminalControl(DISABLE_FOCUS_EVENTS);
}

function stripFocusEvents(data: string): { stripped: string; focused?: boolean } {
  let focused: boolean | undefined;
  const stripped = data.replace(FOCUS_EVENT_PATTERN, (_match, kind: string) => {
    focused = kind === "I";
    return "";
  });

  return { stripped, focused };
}

function getAutoRecapDelay(config: RecapConfig, lastCompletedTurn: LastCompletedTurn): number {
  const elapsed = Date.now() - lastCompletedTurn.completedAt;
  return Math.max(0, config.inactivityMs - elapsed);
}

function getTerminalInputResult(original: string, stripped: string): { consume?: boolean; data?: string } | undefined {
  if (stripped === original) return undefined;
  if (stripped.length === 0) return { consume: true };
  return { data: stripped };
}

function getRecapEntryData(entry: SessionEntry): RecapEntryData | null {
  if (entry.type !== "custom") return null;
  if (entry.customType !== CUSTOM_TYPE) return null;
  if (!isRecord(entry.data)) return null;

  const data = entry.data;
  const action = data.action;
  if (data.type !== CUSTOM_TYPE) return null;
  if (data.version !== 1) return null;
  if (action !== "set" && action !== "clear" && action !== "enable" && action !== "disable") return null;

  return {
    type: CUSTOM_TYPE,
    version: 1,
    action,
    enabled: typeof data.enabled === "boolean" ? data.enabled : undefined,
    text: typeof data.text === "string" ? data.text : undefined,
    key: typeof data.key === "string" ? data.key : undefined,
    source: data.source === "manual" || data.source === "auto" || data.source === "command" ? data.source : undefined,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : entry.timestamp,
  };
}

function applyRecapEntry(state: RecapState, data: RecapEntryData): RecapState {
  const next: RecapState = { ...state, updatedAt: data.updatedAt };

  // Old per-session enable/disable entries are intentionally ignored now that
  // the extension has a global toggle in .pi/agent/.cache/session-recap/state.json.
  if (data.action === "enable" || data.action === "disable") {
    return next;
  }

  if (data.action === "clear") {
    next.text = undefined;
    next.key = undefined;
    return next;
  }

  if (data.action === "set") {
    next.text = data.text;
    next.key = data.key;
  }

  return next;
}

function replayRecapState(ctx: ExtensionContext): RecapState {
  let state: RecapState = { enabled: true };

  for (const entry of ctx.sessionManager.getBranch()) {
    const data = getRecapEntryData(entry);
    if (!data) continue;
    state = applyRecapEntry(state, data);
  }

  return state;
}

function resolveConfiguredModel(ctx: ExtensionContext, config: RecapConfig): { model?: Model<Api>; label?: string; error?: string } {
  if (config.model === "current") {
    if (!ctx.model) return { error: "No current model selected" };
    return { model: ctx.model as Model<Api>, label: `${ctx.model.provider}/${ctx.model.id}` };
  }

  const separator = config.model.indexOf("/");
  if (separator <= 0 || separator === config.model.length - 1) {
    return { error: `Invalid recap.model setting: ${config.model}` };
  }

  const provider = config.model.slice(0, separator);
  const modelId = config.model.slice(separator + 1);
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) return { error: `Recap model not found: ${config.model}` };
  return { model, label: `${model.provider}/${model.id}` };
}

async function generateRecapText(
  ctx: ExtensionContext,
  config: RecapConfig,
  controller: AbortController,
): Promise<string> {
  const conversationText = buildConversationText(ctx, config.maxInputChars);
  if (!conversationText) {
    throw new Error("No conversation text found");
  }

  const selected = resolveConfiguredModel(ctx, config);
  if (!selected.model) {
    throw new Error(selected.error ?? "No recap model available");
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(selected.model);
  if (!auth.ok) {
    throw new Error(auth.error);
  }

  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: buildUserPrompt(conversationText) }],
    timestamp: Date.now(),
  };

  const options: Record<string, unknown> = {
    apiKey: auth.apiKey,
    headers: auth.headers,
    signal: controller.signal,
    maxTokens: Math.min(512, Math.max(128, Math.ceil(config.maxChars / 2))),
    cacheRetention: "short",
  };

  if (selected.model.provider === "openai-codex") {
    options.reasoningEffort = "none";
  }

  const response = await complete(
    selected.model,
    { systemPrompt: buildSystemPrompt(config.maxChars), messages: [userMessage] },
    options,
  );

  if (response.stopReason === "aborted") {
    throw new DOMException("Recap generation aborted", "AbortError");
  }
  if (response.stopReason === "error") {
    throw new Error(response.errorMessage || "Recap generation failed");
  }

  const text = normalizeRecapText(getTextParts(response.content).join("\n"), config.maxChars);
  if (!text) {
    throw new Error("Recap model returned an empty summary");
  }

  return text;
}

export default function sessionRecapExtension(pi: ExtensionAPI) {
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let activeGeneration: ActiveGeneration | undefined;
  let generationSeq = 0;
  let sessionActive = false;
  let terminalFocused = true;
  let lastCompletedTurn: LastCompletedTurn | undefined;
  let unsubscribeTerminalInput: (() => void) | undefined;
  let recapState: RecapState = { enabled: true };
  let visibleRecapText: string | undefined;
  let lastRecapKey: string | undefined;

  const clearAutoTimer = () => {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = undefined;
    }
  };

  const abortGeneration = (source?: RecapSource) => {
    if (!activeGeneration) return;
    if (source && activeGeneration.source !== source) return;
    activeGeneration.controller.abort();
    activeGeneration = undefined;
  };

  const cancelAutoWork = () => {
    clearAutoTimer();
    abortGeneration("auto");
  };

  const cancelAllWork = () => {
    clearAutoTimer();
    abortGeneration();
  };

  const persistRecapEntry = (data: Omit<RecapEntryData, "type" | "version" | "updatedAt"> & { updatedAt?: string }) => {
    const entry: RecapEntryData = {
      type: CUSTOM_TYPE,
      version: 1,
      updatedAt: data.updatedAt ?? nowIso(),
      ...data,
    };

    pi.appendEntry<RecapEntryData>(CUSTOM_TYPE, entry);
    recapState = applyRecapEntry(recapState, entry);
  };

  const syncWidgetFromState = (ctx: ExtensionContext, config: RecapConfig) => {
    recapState.enabled = config.enabled;

    if (!sessionActive || ctx.mode !== "tui" || !config.enabled || !recapState.text) {
      clearRecapWidget(ctx);
      visibleRecapText = undefined;
      return;
    }

    showRecapWidget(ctx, recapState.text);
    visibleRecapText = recapState.text;
    lastRecapKey = recapState.key;
  };

  const enableRecap = async () => {
    await writeGlobalRecapEnabled(true);
    recapState.enabled = true;
  };

  const disableRecap = async (ctx: ExtensionContext) => {
    cancelAutoWork();
    await writeGlobalRecapEnabled(false);
    recapState.enabled = false;
    clearRecapWidget(ctx);
    visibleRecapText = undefined;
  };

  const clearRecap = (ctx: ExtensionContext) => {
    persistRecapEntry({ action: "clear", enabled: recapState.enabled, source: "command" });
    clearRecapWidget(ctx);
    visibleRecapText = undefined;
    lastRecapKey = undefined;
  };

  const runRecap = async (
    ctx: ExtensionContext,
    config: RecapConfig,
    source: RecapSource,
    options: { expectedKey?: string; force?: boolean } = {},
  ) => {
    if (!sessionActive || ctx.mode !== "tui") return;
    if (source === "auto" && !ctx.isIdle()) return;
    if (!config.enabled || !recapState.enabled) {
      notifyManual(ctx, source, "Session recap is off; run /recap to turn it on", "warning");
      return;
    }

    const initialStats = getBranchStats(ctx);
    if (options.expectedKey && options.expectedKey !== initialStats.key) return;
    if (!options.force && initialStats.userTurns < config.minTurns) return;
    if (!options.force && lastRecapKey === initialStats.key) return;
    if (!editorIsBlank(ctx)) {
      notifyManual(ctx, source, "Recap skipped because the editor has draft text", "warning");
      return;
    }

    if (activeGeneration) {
      if (source === "auto") return;
      abortGeneration();
    }

    const controller = new AbortController();
    const generationId = ++generationSeq;
    activeGeneration = {
      id: generationId,
      source,
      key: initialStats.key,
      controller,
    };

    if (source === "manual") {
      ctx.ui.setStatus(STATUS_KEY, "recap…");
    }

    try {
      const recap = await generateRecapText(ctx, config, controller);

      if (!sessionActive) return;
      if (activeGeneration?.id !== generationId) return;

      const currentStats = getBranchStats(ctx);
      if (currentStats.key !== initialStats.key) {
        notifyManual(ctx, source, "Recap discarded because the session changed", "warning");
        return;
      }

      if (!editorIsBlank(ctx)) {
        notifyManual(ctx, source, "Recap discarded because the editor has draft text", "warning");
        return;
      }

      persistRecapEntry({
        action: "set",
        enabled: true,
        text: recap,
        key: initialStats.key,
        source,
      });
      showRecapWidget(ctx, recap);
      visibleRecapText = recap;
      lastRecapKey = initialStats.key;
    } catch (error) {
      if (!isAbortLike(error)) {
        notifyManual(
          ctx,
          source,
          error instanceof Error ? error.message : `Recap failed: ${String(error)}`,
          "error",
        );
      }
    } finally {
      if (activeGeneration?.id === generationId) {
        activeGeneration = undefined;
      }
      if (source === "manual") {
        ctx.ui.setStatus(STATUS_KEY, undefined);
      }
    }
  };

  const scheduleAutoRecap = async (ctx: ExtensionContext) => {
    if (!sessionActive || ctx.mode !== "tui") return;
    if (terminalFocused) return;

    const completedTurn = lastCompletedTurn;
    if (!completedTurn) return;

    const config = await loadRecapConfig(ctx);
    recapState.enabled = config.enabled;
    if (!config.enabled || !config.auto) return;
    if (!ctx.isIdle()) return;

    const stats = getBranchStats(ctx);
    if (stats.key !== completedTurn.stats.key) return;
    if (stats.userTurns < config.minTurns) return;
    if (lastRecapKey === stats.key) return;

    clearAutoTimer();
    autoTimer = setTimeout(() => {
      autoTimer = undefined;
      if (terminalFocused || !ctx.isIdle() || !editorIsBlank(ctx)) return;
      void runRecap(ctx, config, "auto", { expectedKey: stats.key });
    }, getAutoRecapDelay(config, completedTurn));
    (autoTimer as { unref?: () => void }).unref?.();
  };

  const installTerminalInputListener = (ctx: ExtensionContext) => {
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;

    if (ctx.mode !== "tui") return;

    try {
      unsubscribeTerminalInput = ctx.ui.onTerminalInput((data) => {
        const { stripped, focused } = stripFocusEvents(data);

        if (typeof focused === "boolean") {
          terminalFocused = focused;
          if (terminalFocused) {
            clearAutoTimer();
          } else {
            void scheduleAutoRecap(ctx);
          }
        }

        if (stripped.length > 0) {
          cancelAutoWork();
        }

        return getTerminalInputResult(data, stripped);
      });
    } catch {
      // Non-TUI contexts expose a no-op/unsupported terminal input API.
    }
  };

  const reloadStateAndWidget = async (ctx: ExtensionContext) => {
    recapState = replayRecapState(ctx);
    const config = await loadRecapConfig(ctx);
    syncWidgetFromState(ctx, config);
  };

  pi.on("session_start", async (_event, ctx) => {
    cancelAllWork();
    sessionActive = ctx.mode === "tui";
    terminalFocused = true;
    lastCompletedTurn = undefined;
    recapState = replayRecapState(ctx);
    visibleRecapText = undefined;
    lastRecapKey = recapState.key;

    if (ctx.mode === "tui") {
      enableTerminalFocusEvents();
      const config = await loadRecapConfig(ctx);
      syncWidgetFromState(ctx, config);
      installTerminalInputListener(ctx);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    sessionActive = false;
    lastCompletedTurn = undefined;
    cancelAllWork();
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;
    disableTerminalFocusEvents();
    clearRecapWidget(ctx);
  });

  pi.on("input", async () => {
    lastCompletedTurn = undefined;
    cancelAllWork();
  });

  pi.on("agent_start", async () => {
    lastCompletedTurn = undefined;
    cancelAllWork();
  });

  pi.on("session_tree", async (_event, ctx) => {
    lastCompletedTurn = undefined;
    cancelAllWork();
    await reloadStateAndWidget(ctx);
  });

  pi.on("session_compact", async (_event, ctx) => {
    lastCompletedTurn = undefined;
    cancelAllWork();
    await reloadStateAndWidget(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    lastCompletedTurn = {
      completedAt: Date.now(),
      stats: getBranchStats(ctx),
    };
    await scheduleAutoRecap(ctx);
  });

  pi.registerCommand("recap", {
    description: "Toggle the persistent one-line session recap above the editor",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("/recap is only available in interactive TUI mode", "warning");
        return;
      }

      await ctx.waitForIdle();
      const config = await loadRecapConfig(ctx);
      const trimmed = args.trim().toLowerCase();

      if (trimmed === "off" || trimmed === "disable" || trimmed === "hide") {
        await disableRecap(ctx);
        config.enabled = false;
        ctx.ui.notify("Session recap off globally", "info");
        return;
      }

      if (trimmed === "clear") {
        clearRecap(ctx);
        ctx.ui.notify("Session recap cleared", "info");
        return;
      }

      if (trimmed === "on" || trimmed === "enable" || trimmed === "show") {
        await enableRecap();
        config.enabled = true;
        syncWidgetFromState(ctx, config);
        if (!visibleRecapText) {
          await runRecap(ctx, config, "manual", { force: true });
        }
        return;
      }

      if (trimmed === "refresh" || trimmed === "now" || trimmed === "update") {
        await enableRecap();
        config.enabled = true;
        await runRecap(ctx, config, "manual", { force: true });
        return;
      }

      if (trimmed.length > 0) {
        ctx.ui.notify("Usage: /recap [on|off|clear|refresh]", "warning");
        return;
      }

      if (config.enabled && recapState.enabled && visibleRecapText) {
        await disableRecap(ctx);
        config.enabled = false;
        ctx.ui.notify("Session recap off globally", "info");
        return;
      }

      await enableRecap();
      config.enabled = true;
      await runRecap(ctx, config, "manual", { force: true });
    },
  });
}
