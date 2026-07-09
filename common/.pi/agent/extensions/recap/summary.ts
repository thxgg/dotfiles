import { completeSimple, type Api, type Model, type UserMessage } from "@earendil-works/pi-ai/compat";
import {
  convertToLlm,
  serializeConversation,
  sessionEntryToContextMessages,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { RecapConfig } from "./config.ts";

const OMITTED = "\n\n[Earlier transcript omitted.]\n\n";

export function truncateTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text.trim();
  const head = Math.min(3_000, Math.floor(maxChars * 0.15));
  return `${text.slice(0, head)}${OMITTED}${text.slice(-(maxChars - head - OMITTED.length))}`.trim();
}

function serializeEntries(entries: SessionEntry[]): string {
  const messages = entries.flatMap(sessionEntryToContextMessages);
  return serializeConversation(convertToLlm(messages));
}

export function buildBoundedTranscript(ctx: ExtensionContext, maxChars: number): string {
  const entries = ctx.sessionManager.buildContextEntries();
  if (entries.length === 0) return "";

  // Serialize only a bounded suffix. This avoids materializing a huge session merely
  // to discard most of it, while retaining compaction/branch summaries near the head.
  const selected: SessionEntry[] = [];
  let estimate = 0;
  for (let index = entries.length - 1; index >= 0 && estimate < maxChars * 1.25; index -= 1) {
    const entry = entries[index];
    selected.unshift(entry);
    estimate += JSON.stringify(entry).length;
  }
  if (selected[0] !== entries[0] && (entries[0]?.type === "compaction" || entries[0]?.type === "branch_summary")) {
    selected.unshift(entries[0]);
  }
  return truncateTranscript(serializeEntries(selected), maxChars);
}

export function normalizeSummary(text: string, maxChars: number): string {
  let summary = text
    .replace(/```(?:\w+)?|```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/^recap:\s*/i, "")
    .replace(/\*\*|__/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (summary.length > maxChars) summary = `${summary.slice(0, maxChars - 1).trimEnd()}…`;
  return summary;
}

export function resolveModel(ctx: ExtensionContext, configured: string): Model<Api> {
  if (configured === "current") {
    if (!ctx.model) throw new Error("No current model selected");
    return ctx.model as Model<Api>;
  }
  const separator = configured.indexOf("/");
  if (separator <= 0) throw new Error(`Invalid recap.model: ${configured}`);
  const model = ctx.modelRegistry.find(configured.slice(0, separator), configured.slice(separator + 1));
  if (!model) throw new Error(`Recap model not found: ${configured}`);
  return model;
}

export async function generateSummary(
  ctx: ExtensionContext,
  config: RecapConfig,
  signal: AbortSignal,
): Promise<string> {
  const transcript = buildBoundedTranscript(ctx, config.maxInputChars);
  if (!transcript) throw new Error("No conversation to recap");
  const model = resolveModel(ctx, config.model);
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);

  const message: UserMessage = {
    role: "user",
    content: [{ type: "text", text: `Summarize this coding session for a returning user:\n\n<transcript>\n${transcript}\n</transcript>` }],
    timestamp: Date.now(),
  };
  const response = await completeSimple(model, {
    systemPrompt: [
      `Write one line of at most ${config.maxChars} characters.`,
      "State the goal, progress, blocker, and next action when known.",
      "No markdown, preamble, or conversational response.",
    ].join("\n"),
    messages: [message],
  }, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
    signal,
    reasoning: "minimal",
    maxTokens: Math.max(64, Math.ceil(config.maxChars / 2)),
    cacheRetention: "short",
  });

  if (response.stopReason === "aborted") throw new DOMException("Aborted", "AbortError");
  if (response.stopReason === "error") throw new Error(response.errorMessage || "Recap generation failed");
  const text = response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const summary = normalizeSummary(text, config.maxChars);
  if (!summary) throw new Error("Recap model returned an empty summary");
  return summary;
}
