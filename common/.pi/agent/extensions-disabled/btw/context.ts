import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Snapshot projected context without parent prompts or incomplete tool-call batches. */
export function buildParentMessages(projected: readonly AgentMessage[]): AgentMessage[] {
  const messages = projected.filter(message => message.role !== "system");
  const results = new Set(messages.flatMap(message => message.role === "toolResult" ? [message.toolCallId] : []));
  const incomplete = messages.findIndex(message => message.role === "assistant" &&
    (message.stopReason === undefined || message.content.some(part => part.type === "toolCall" && !results.has(part.id))));
  return structuredClone(incomplete < 0 ? messages : messages.slice(0, incomplete));
}
