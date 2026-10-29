import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import {
  buildSessionProjection,
  estimateTokens,
  generateSummaryWithUsage,
  SettingsManager,
  type CompactionResult,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

const START_RATIO = 0.85;
const MIN_PROMPT_TOKENS = 64_000;
const TIMEOUT_MS = 300_000;
const MAX_SUMMARY_TOKENS = 8_192;
const SOURCE = "background-compaction";

type Budgets = { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
type Checkpoint = {
  readonly sessionId: string;
  readonly identity: string;
  readonly prefixHash: string;
  readonly firstKeptEntryId: string;
  readonly messages: AgentMessage[];
  readonly previousSummary: string | undefined;
  readonly request: CachedRequest | undefined;
};
type CachedRequest = {
  readonly payload: Record<string, unknown> & { input: unknown[] };
  readonly prefixHash: string;
};

const SUMMARY_INSTRUCTIONS = `Create a concise checkpoint of the conversation above so another assistant can continue it.
This is a summarization request, not a request to continue the task. Do not call tools.
Include these sections: Goal, Constraints & Preferences, Progress (Done, In Progress, Blocked), Key Decisions, Next Steps, Critical Context.
Preserve exact relevant file paths, identifiers, commands, errors, unresolved requests, and read/modified file lists.
Update any earlier checkpoint using the subsequent conversation. Do not invent later work.
The latest response and all later messages will be retained separately. Aim for 800–1200 words. Keep only details needed to continue safely.
Return only the checkpoint.`;

function parseCachedPayload(payload: unknown): CachedRequest["payload"] | undefined {
  if (!payload || typeof payload !== "object" || !("input" in payload) || !Array.isArray(payload.input) ||
    !("model" in payload) || typeof payload.model !== "string" ||
    ("previous_response_id" in payload && payload.previous_response_id) ||
    ("conversation" in payload && payload.conversation)) return undefined;
  // SAFETY: The provider hook supplies an object with a full input array and model.
  // Do not reuse server-side conversation state; the prefix must be self-contained.
  return structuredClone(payload) as CachedRequest["payload"];
}

type SummaryOutcome =
  | { readonly kind: "ready"; readonly text: string; readonly usage: Usage }
  | { readonly kind: "unavailable" };
type Job = {
  readonly checkpoint: Checkpoint;
  readonly controller: AbortController;
  readonly result: Promise<SummaryOutcome>;
};
type State =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly job: Job }
  | { readonly kind: "ready"; readonly job: Job; readonly summary: Extract<SummaryOutcome, { kind: "ready" }> };

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function visibleEntries(entries: SessionEntry[]) {
  return buildSessionProjection(entries).entries.filter((entry) => entry.messages.length > 0);
}

function tokenCount(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

function tailLimit(budgets: Budgets, ceiling: number): number {
  return Math.min(Math.max(2 * budgets.keepRecentTokens, 30_000), Math.floor(ceiling * 0.25));
}

/** Precompute a prefix summary without changing context until Pi requests compaction. */
export default function backgroundCompaction(pi: ExtensionAPI): void {
  let enabled = true;
  let state: State = { kind: "idle" };
  let failures = 0;
  let lastAttempt: string | undefined;
  let request: CachedRequest | undefined;

  function report(stage: string, data: Record<string, unknown> = {}): void {
    // Metadata only: never publish prompts, summaries, headers, or credentials.
    pi.events.emit("background-compaction", { stage, ...data });
  }

  function capture(payload: unknown, ctx: ExtensionContext): void {
    request = undefined;
    if (ctx.model?.provider !== "openai" || ctx.model.api !== "openai-responses") return;
    const parsed = parseCachedPayload(payload);
    if (parsed) request = { payload: parsed, prefixHash: hash(visibleEntries(ctx.sessionManager.getBranch())) };
  }

  // Load this extension after other before_provider_request transformers. Pi
  // orders these hooks by extension, not by handler registration time.
  pi.on("before_provider_request", (event, ctx) => capture(event.payload, ctx));
  pi.on("turn_start", () => { request = undefined; });

  function discard(_ctx: ExtensionContext): void {
    const previous = state;
    state = { kind: "idle" };
    if (previous.kind !== "idle") previous.job.controller.abort();
  }

  function reset(ctx: ExtensionContext): void {
    discard(ctx);
    failures = 0;
    lastAttempt = undefined;
    request = undefined;
  }

  function budgets(ctx: ExtensionContext): Budgets | undefined {
    // Use the host's effective settings, including trust, SDK overrides, and /settings.
    // This manager is in-memory only; it never reads or rewrites settings files.
    try {
      return SettingsManager.inMemory(pi.getSettings()).getCompactionSettings(ctx.model);
    } catch {
      discard(ctx);
      return undefined;
    }
  }

  function identity(ctx: ExtensionContext, settings: Budgets): string {
    const active = new Set(pi.getActiveTools());
    return hash({
      model: ctx.model,
      thinking: ctx.thinkingLevel,
      prompt: ctx.getSystemPrompt(),
      tools: pi.getAllTools().filter((tool) => active.has(tool.name)),
      settings,
    });
  }

  function isUsable(checkpoint: Checkpoint, ctx: ExtensionContext, settings: Budgets, entries: SessionEntry[]): boolean {
    if (!enabled || !settings.enabled || !ctx.model ||
      checkpoint.sessionId !== ctx.sessionManager.getSessionId() ||
      checkpoint.identity !== identity(ctx, settings)) return false;
    const visible = visibleEntries(entries);
    const cut = visible.findIndex((entry) => entry.sourceEntry.id === checkpoint.firstKeptEntryId);
    if (cut < 1 || hash(visible.slice(0, cut)) !== checkpoint.prefixHash) return false;
    const tail = visible.slice(cut).flatMap((entry) => entry.messages);
    return tokenCount(tail) <= tailLimit(settings, ctx.model.contextWindow - settings.reserveTokens);
  }

  async function summarize(checkpoint: Checkpoint, ctx: ExtensionContext, controller: AbortController): Promise<SummaryOutcome> {
    const model = ctx.model;
    if (!model) return { kind: "unavailable" };
    try {
      if (checkpoint.request) {
        const original = checkpoint.request.payload;
        const started = Date.now();
        const response = await ctx.modelRegistry.streamSimple(model, {
          messages: [{ role: "user", content: SUMMARY_INSTRUCTIONS, timestamp: started }],
        }, {
          signal: controller.signal,
          sessionId: checkpoint.sessionId,
          cacheRetention: "short",
          reasoning: ctx.thinkingLevel === "off" ? undefined : ctx.thinkingLevel,
          maxTokens: Math.min(MAX_SUMMARY_TOKENS, model.maxTokens),
          transport: pi.getSettings().transport,
          onResponse: (response) => report("summary_response", { status: response.status, elapsedMs: Date.now() - started }),
          onPayload: () => ({
            ...structuredClone(original),
            input: [...structuredClone(original.input), {
              role: "user", content: [{ type: "input_text", text: SUMMARY_INSTRUCTIONS }],
            }],
            // Keep tool declarations byte-identical for cache reuse, but disable calls.
            tool_choice: "none",
            // ChatGPT subscription auth rejects max_output_tokens. Only set it when
            // the original serializer declared support (the deadline always applies).
            ...(typeof original.max_output_tokens === "number"
              ? { max_output_tokens: Math.min(MAX_SUMMARY_TOKENS, model.maxTokens) } : {}),
          }),
        }).result();
        report("summary_finished", {
          mode: "openai-prefix", elapsedMs: Date.now() - started,
          stopReason: response.stopReason, usage: response.usage,
          prefixItems: original.input.length, prefixHash: hash(original.input),
          cacheKeyHash: hash(original.prompt_cache_key ?? null),
        });
        const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        if (controller.signal.aborted || response.stopReason !== "stop" ||
          response.content.some((block) => block.type === "toolCall") || !text.trim()) return { kind: "unavailable" };
        return { kind: "ready", text, usage: response.usage };
      }
      let completed = false;
      // Reuse Pi's summary prompt and serializer, but route through the host registry
      // for OAuth, model aliases, and provider wrappers. No tools can run here.
      const result = await generateSummaryWithUsage(
        checkpoint.messages, model, undefined, undefined, undefined,
        controller.signal, undefined, checkpoint.previousSummary, ctx.thinkingLevel,
        async (requestModel, context, options) => {
          const stream = ctx.modelRegistry.streamSimple(requestModel, context, {
            ...options,
            maxTokens: Math.min(MAX_SUMMARY_TOKENS, model.maxTokens),
            // A separate routing session cannot contend with the conversation's socket.
            sessionId: `${checkpoint.sessionId}-background-compaction`,
          });
          completed = (await stream.result()).stopReason === "stop";
          return stream;
        },
      );
      if (!completed || controller.signal.aborted || !result.text.trim()) return { kind: "unavailable" };
      return { kind: "ready", text: result.text, usage: result.usage };
    } catch {
      // Expected provider/auth/length failures leave native compaction available.
      // Keep provider errors private; they can contain request data.
      return { kind: "unavailable" };
    }
  }

  function start(checkpoint: Checkpoint, ctx: ExtensionContext): void {
    const controller = new AbortController();
    let onAbort = () => {};
    const aborted = new Promise<SummaryOutcome>((resolve) => {
      onAbort = () => resolve({ kind: "unavailable" });
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    timeout.unref();
    const result = Promise.race([summarize(checkpoint, ctx, controller), aborted]).finally(() => {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", onAbort);
    });
    const job: Job = { checkpoint, controller, result };
    state = { kind: "running", job };
    lastAttempt = checkpoint.firstKeptEntryId;
    report("started", { mode: checkpoint.request ? "openai-prefix" : "serialized", firstKeptEntryId: checkpoint.firstKeptEntryId });
    void result.then((summary) => {
      if (state.kind === "idle" || state.job !== job) return;
      if (summary.kind === "unavailable") {
        state = { kind: "idle" };
        failures++;
        return;
      }
      state = { kind: "ready", job, summary };
      report("ready", { usage: summary.usage });
    });
  }

  function consider(ctx: ExtensionContext): void {
    const settings = budgets(ctx);
    if (!settings) return;
    if (!enabled || !settings.enabled || !ctx.model) {
      discard(ctx);
      return;
    }
    const entries = ctx.sessionManager.getBranch();
    if (state.kind !== "idle") {
      if (isUsable(state.job.checkpoint, ctx, settings, entries)) return;
      discard(ctx);
    }
    const usage = ctx.getContextUsage();
    const ceiling = ctx.model.contextWindow - settings.reserveTokens;
    if (!usage || usage.tokens === null || !Number.isFinite(ceiling) || ceiling <= 0 ||
      usage.tokens < ceiling * START_RATIO || usage.tokens >= ceiling || failures >= 2) return;

    const visible = visibleEntries(entries);
    // Retain the newest complete assistant/tool batch, never cut at a tool result.
    const cut = visible.findLastIndex((entry) => entry.sourceEntry.type === "message" &&
      entry.sourceEntry.message.role === "assistant");
    const anchor = visible[cut]?.sourceEntry;
    if (cut < 1 || anchor?.type !== "message" || anchor.message.role !== "assistant" ||
      anchor.id === lastAttempt) return;
    const response = anchor.message;
    if (response.provider !== ctx.model.provider || response.model !== ctx.model.id ||
      (response.stopReason !== "stop" && response.stopReason !== "toolUse") ||
      response.usage.input + response.usage.cacheRead + response.usage.cacheWrite < MIN_PROMPT_TOKENS) return;
    const prefix = visible.slice(0, cut);
    const messages = prefix.flatMap((entry) => entry.messages);
    const priorSummary = messages.findLast((message) => message.role === "compactionSummary");
    const checkpoint: Checkpoint = {
      sessionId: ctx.sessionManager.getSessionId(),
      identity: identity(ctx, settings),
      prefixHash: hash(prefix),
      firstKeptEntryId: anchor.id,
      messages: structuredClone(messages.filter((message) => message.role !== "system" && message.role !== "compactionSummary")),
      previousSummary: priorSummary?.role === "compactionSummary" ? priorSummary.summary : undefined,
      request: request?.prefixHash === hash(prefix) ? request : undefined,
    };
    // An OpenAI request must have an exact, current serialized prefix. Never
    // silently pay for a reformatted request when prefix capture was unavailable.
    if (ctx.model.provider === "openai" && ctx.model.api === "openai-responses" && !checkpoint.request) return;
    if (checkpoint.messages.length === 0 || !isUsable(checkpoint, ctx, settings, entries)) return;
    start(checkpoint, ctx);
  }

  pi.on("turn_end", (event, ctx) => {
    if (event.outcome !== "completed") {
      discard(ctx);
      return;
    }
    // Other boundary extensions may still change context. Check again on use.
    consider(ctx);
  });
  pi.on("agent_settled", (event, ctx) => {
    if (event.aborted) discard(ctx);
    else consider(ctx);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    // Explicit instructions and overflow recovery always get a fresh native summary.
    if (event.reason !== "threshold" || event.customInstructions || event.signal.aborted) {
      discard(ctx);
      return;
    }
    const held = state;
    if (held.kind === "idle" || !isUsable(held.job.checkpoint, ctx, event.preparation.settings, event.branchEntries)) {
      discard(ctx);
      return;
    }
    const { job } = held;
    const abort = () => discard(ctx);
    event.signal.addEventListener("abort", abort, { once: true });
    // If the threshold arrives first, wait only for the existing bounded request.
    const summary = held.kind === "ready" ? held.summary : await job.result;
    event.signal.removeEventListener("abort", abort);
    const current = state;
    if (event.signal.aborted || summary.kind !== "ready" || current.kind === "idle" || current.job !== job ||
      !isUsable(job.checkpoint, ctx, event.preparation.settings, ctx.sessionManager.getBranch())) {
      discard(ctx);
      return;
    }
    const compaction: CompactionResult = {
      summary: summary.text,
      firstKeptEntryId: job.checkpoint.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
      usage: summary.usage,
      details: { source: SOURCE, version: 1 },
    };
    // Also reject summaries that fail to make room, including large fixed prompts.
    // Use Pi's real projection to include its summary and system checkpoint framing.
    const entries = ctx.sessionManager.getBranch();
    const candidate: SessionEntry = {
      ...compaction, type: "compaction", id: "background-compaction-preview",
      parentId: ctx.sessionManager.getLeafId(), timestamp: new Date().toISOString(),
    };
    const projected = buildSessionProjection([...entries, candidate]).messages;
    const fixed = Math.ceil(ctx.getSystemPrompt().length / 4) +
      Math.ceil(JSON.stringify(pi.getAllTools().filter((tool) => pi.getActiveTools().includes(tool.name))).length / 4);
    const ceiling = (ctx.model?.contextWindow ?? 0) - event.preparation.settings.reserveTokens;
    if (tokenCount(projected) + fixed >= ceiling * START_RATIO) {
      discard(ctx);
      return;
    }
    state = { kind: "idle" };
    report("applied", { firstKeptEntryId: compaction.firstKeptEntryId, tokensBefore: compaction.tokensBefore,
      estimatedTokensAfter: tokenCount(projected) + fixed, mode: job.checkpoint.request ? "openai-prefix" : "serialized" });
    return { compaction };
  });

  pi.on("session_start", (_event, ctx) => { enabled = true; reset(ctx); });
  pi.on("session_shutdown", (_event, ctx) => reset(ctx));
  pi.on("session_before_switch", (_event, ctx) => reset(ctx));
  pi.on("session_before_fork", (_event, ctx) => reset(ctx));
  pi.on("session_before_tree", (_event, ctx) => reset(ctx));
  pi.on("session_compact", (_event, ctx) => reset(ctx));
  pi.on("session_compact_failed", (_event, ctx) => reset(ctx));
  pi.on("model_select", (_event, ctx) => reset(ctx));

  pi.registerCommand("bg-compact", {
    description: "Background compaction: status, on, or off (this session only)",
    handler: async (args, ctx) => {
      const command = args.trim() || "status";
      if (command === "off") { enabled = false; discard(ctx); }
      else if (command === "on") { enabled = true; reset(ctx); consider(ctx); }
      else if (command !== "status") {
        ctx.ui.notify("Usage: /bg-compact [status|on|off]", "warning");
        return;
      }
      ctx.ui.notify(`Background compaction: ${enabled ? state.kind : "off"}. Starts at 85% of Pi's compaction threshold, with at least 64k measured prompt tokens.`, "info");
    },
  });
}
