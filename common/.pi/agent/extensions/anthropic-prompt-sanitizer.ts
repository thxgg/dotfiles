import type { SystemMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PI_DOCUMENTATION_ANCHOR =
  "Pi documentation (read only when the user asks about pi itself";

function stripPiDocumentation(text: string): string {
  if (!text.includes(PI_DOCUMENTATION_ANCHOR)) return text;
  // Older sessions can hold a flattened prompt instead of named sections.
  return text
    .replace(/<docs>[\s\S]*?<\/docs>/g, block => block.includes(PI_DOCUMENTATION_ANCHOR) ? "" : block)
    .split(/\n\n+/)
    .filter(paragraph => !paragraph.includes(PI_DOCUMENTATION_ANCHOR))
    .join("\n\n");
}

function sanitizeSystemMessage(message: SystemMessage): SystemMessage {
  let changed = false;
  const content = typeof message.content === "string"
    ? stripPiDocumentation(message.content)
    : message.content.map(block => {
      const text = stripPiDocumentation(block.text);
      if (text === block.text) return block;
      changed = true;
      return { ...block, text };
    });
  if (typeof content === "string" && content !== message.content) changed = true;

  const sections = message.sections && Object.fromEntries(
    Object.entries(message.sections).map(([name, value]) => {
      if (value === null || !value.includes(PI_DOCUMENTATION_ANCHOR)) return [name, value];
      changed = true;
      // Keep the removal delta so replay cannot restore an earlier docs section.
      return [name, name === "docs" ? null : stripPiDocumentation(value)];
    }),
  );
  return changed ? { ...message, content, ...(sections ? { sections } : {}) } : message;
}

/** Remove Pi documentation only from Anthropic request context, never saved history or tools. */
export default function anthropicPromptSanitizer(pi: ExtensionAPI): void {
  pi.on("context_with_system", (event, ctx) => {
    if (ctx.model?.provider !== "anthropic") return;
    const messages = event.messages.map(message => message.role === "system" ? sanitizeSystemMessage(message) : message);
    if (messages.every((message, index) => message === event.messages[index])) return;
    return { messages };
  });
}
