import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";

type ContextMessage = ReturnType<typeof sessionEntryToContextMessages>[number];

function hasToolCall(message: ContextMessage): boolean {
  return message.role === "assistant" && message.content.some((part) => part.type === "toolCall");
}

/**
 * Build a provider-valid snapshot of the parent context.
 *
 * During parent tool execution the session branch ends with an assistant
 * tool-call message, while its tool result does not exist yet. A child request
 * cannot reuse that dangling call, so omit it; live operation details remain
 * available through get_main_thread_activity.
 */
export function buildParentMessages(entries: readonly SessionEntry[]): ContextMessage[] {
  const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry as SessionEntry));
  const last = messages.at(-1);
  if (last?.role === "assistant" && (last.stopReason === undefined || hasToolCall(last))) {
    return messages.slice(0, -1);
  }
  return messages;
}
