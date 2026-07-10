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
const RECENT_MESSAGE_WINDOW = 30;

export function truncateTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text.trim();
  const head = Math.min(3_000, Math.floor(maxChars * 0.15));
  return `${text.slice(0, head)}${OMITTED}${text.slice(-(maxChars - head - OMITTED.length))}`.trim();
}

function serializeEntries(entries: SessionEntry[]): string {
  const messages = entries.flatMap(sessionEntryToContextMessages);
  return serializeConversation(convertToLlm(messages));
}

export function selectRecapEntries(entries: SessionEntry[]): SessionEntry[] {
  if (entries.length === 0) return [];

  const recentMessages = entries
    .filter((entry) => entry.type === "message" || entry.type === "custom_message")
    .slice(-RECENT_MESSAGE_WINDOW);
  const memory = entries.findLast((entry) => entry.type === "compaction" || entry.type === "branch_summary");
  if (!memory) return recentMessages;
  const selectedIds = new Set([memory.id, ...recentMessages.map((entry) => entry.id)]);
  return entries.filter((entry) => selectedIds.has(entry.id));
}

export function serializeRecapEntries(entries: SessionEntry[], maxChars: number): string {
  if (entries.length === 0) return "";

  const memory = entries.find((entry) => entry.type === "compaction" || entry.type === "branch_summary");
  const messages = entries.filter((entry) => entry !== memory);
  const headersLength = (memory ? "[Session memory]\n".length : 0)
    + (messages.length > 0 ? "[Recent conversation]\n".length : 0)
    + Math.max(0, messages.length - 1)
    + (memory && messages.length > 0 ? 2 : 0);
  const payloadBudget = Math.max(0, maxChars - headersLength);
  const memoryBudget = memory ? Math.min(Math.floor(payloadBudget * 0.25), 5_000) : 0;
  const messageBudget = messages.length > 0
    ? Math.floor((payloadBudget - memoryBudget) / messages.length)
    : 0;
  const sections: string[] = [];

  if (memory) sections.push(`[Session memory]\n${truncateTranscript(serializeEntries([memory]), memoryBudget)}`);
  if (messages.length > 0) {
    sections.push(`[Recent conversation]\n${messages
      .map((entry) => truncateTranscript(serializeEntries([entry]), messageBudget))
      .join("\n")}`);
  }
  return sections.join("\n\n");
}

export function buildBoundedTranscript(ctx: ExtensionContext, maxChars: number): string {
  return serializeRecapEntries(selectRecapEntries(ctx.sessionManager.getBranch()), maxChars);
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
      `Write one recap line of at most ${config.maxChars} characters.`,
      "State exactly two things: the high-level task, then the concrete next action.",
      "Do not inventory implementation details or write a status report or commit recap.",
      "No markdown, blank lines, preamble, or conversational response.",
    ].join("\n"),
    messages: [message],
  }, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
    signal,
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
