import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ANTHROPIC_PROVIDER = "anthropic";
const PI_DOCUMENTATION_ANCHOR =
  "Pi documentation (read only when the user asks about pi itself";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as JsonRecord;
}

function stripPiDocumentationParagraph(text: string): string {
  return text
    .split(/\n\n+/)
    .filter((paragraph) => !paragraph.includes(PI_DOCUMENTATION_ANCHOR))
    .join("\n\n");
}

function sanitizeSystemBlock(value: unknown): { readonly value: unknown; readonly changed: boolean } {
  const block = asRecord(value);
  if (block?.type !== "text" || typeof block.text !== "string") {
    return { value, changed: false };
  }

  const text = stripPiDocumentationParagraph(block.text);
  if (text === block.text) {
    return { value, changed: false };
  }

  return { value: { ...block, text }, changed: true };
}

/**
 * Removes Pi's documentation paragraph from Anthropic provider requests.
 * Other providers and all non-system payload fields pass through unchanged.
 */
export default function anthropicPromptSanitizer(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== ANTHROPIC_PROVIDER) {
      return;
    }

    const payload = asRecord(event.payload);
    if (!payload || !Array.isArray(payload.system)) {
      return;
    }

    let changed = false;
    const system = payload.system.map((value) => {
      const result = sanitizeSystemBlock(value);
      changed ||= result.changed;
      return result.value;
    });

    if (!changed) {
      return;
    }

    return { ...payload, system };
  });
}
