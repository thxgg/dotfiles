import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";

const MAX_SCHEMA_NODES = 10_000;
const MAX_SCHEMA_DEPTH = 24;

export function isBoundedJsonSchema(value: unknown): value is TSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const seen = new WeakSet<object>();
  let nodes = 0;
  const walk = (current: unknown, depth: number): boolean => {
    if (++nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) return false;
    if (current === null || typeof current === "string" || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current);
    if (Array.isArray(current)) return current.every((item) => walk(item, depth + 1));
    if (!current || typeof current !== "object" || seen.has(current)) return false;
    seen.add(current);
    return Object.keys(current).every((key) =>
      !["__proto__", "constructor", "prototype"].includes(key) && walk((current as Record<string, unknown>)[key], depth + 1));
  };
  return walk(value, 0);
}

export function createStructuredOutputTool(schema: unknown, capture: (value: unknown) => void): ToolDefinition {
  if (!isBoundedJsonSchema(schema)) throw new Error("Structured output schema must be a bounded JSON object.");
  return defineTool({
    name: "structured_output",
    label: "Structured Output",
    description: "Return final structured data matching the required schema. Call exactly once as the last action.",
    parameters: Type.Unsafe(schema),
    async execute(_toolCallId, params) {
      capture(params);
      return { content: [{ type: "text", text: "Recorded structured result." }], details: params, terminate: true };
    },
  });
}

export const STRUCTURED_OUTPUT_INSTRUCTION =
  "When the task is complete, call structured_output exactly once as your final action with fields matching the required schema. Do not write text after it.";
