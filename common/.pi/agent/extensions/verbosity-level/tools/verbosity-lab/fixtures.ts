import type { AssistantMessage } from "@earendil-works/pi-ai";

/** Render-only replay events. Tool calls contain data, never execution delegates. */
export type ReplayEvent =
  | { readonly type: "user" | "assistant"; readonly text: string }
  | { readonly type: "call"; readonly id: string; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly type: "result"; readonly id: string; readonly text: string; readonly error: boolean }
  | { readonly type: "boundary"; readonly text: string };
/** A deterministic scenario for both verbosity levels. */
export interface Fixture { readonly name: string; readonly events: readonly ReplayEvent[] }

/** Construct native assistant data without a provider or model request. */
export function assistant(text: string): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "offline", model: "fixture", stopReason: "stop", timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
const call = (id: string, name: string, args: Record<string, unknown>): ReplayEvent => ({ type: "call", id, name, args });
const result = (id: string, text: string, error = false): ReplayEvent => ({ type: "result", id, text, error });

/** Synthetic cases include boundaries, failures, pending work, and unsupported tools. */
export const fixtures: readonly Fixture[] = [
  { name: "Explore → edit → verify", events: [
    { type: "user", text: "Add a low verbosity option. Keep normal output unchanged." },
    { type: "assistant", text: "I’ll check the renderer and its tests first." },
    call("r1", "read", { path: "src/render.ts" }), call("r2", "grep", { pattern: "verbosity", path: "test" }),
    result("r2", "test/render.test.ts:12: test('normal verbosity keeps native rows')"),
    result("r1", "export function render(mode: 'low' | 'normal') {\n  return mode === 'low' ? compact() : native();\n}"),
    { type: "assistant", text: "The native renderer already supports expansion. I’ll keep that behavior." },
    call("e1", "edit", { path: "src/render.ts", edits: [{ oldText: "compact()", newText: "grouped()" }] }),
    result("e1", "Successfully replaced text in src/render.ts."),
    call("b1", "bash", { command: "npm test" }), result("b1", "✓ native rows\n✓ grouped tools\n✓ assistant boundaries\n\nTests: 3 passed"),
    call("b2", "bash", { command: "git diff --check" }), result("b2", ""),
    { type: "assistant", text: "Added **low** verbosity. Normal output is unchanged.\n\n- Tests: **3 passed**\n- `git diff --check`: passed" },
  ] },
  { name: "Failure and cancellation", events: [
    { type: "user", text: "Run the checks and show any failures." },
    call("f1", "bash", { command: "npm run typecheck" }), result("f1", "src/render.ts(8,3): error TS2322: Type 'string' is not assignable to type 'Verbosity'.\nCommand exited with code 2", true),
    call("f2", "bash", { command: "npm run slow-test" }), result("f2", "Command aborted", true),
    { type: "assistant", text: "Type checking failed. The slow test was cancelled. Neither result is hidden." },
  ] },
  { name: "Unsupported tools and long output", events: [
    { type: "user", text: "Check the docs, then inspect the files." },
    call("u1", "read", { path: "README.md" }), result("u1", "# Renderer\nThe normal mode uses native Pi components."),
    call("u2", "mcp", { search: "documentation" }), result("u2", "Unsupported tools keep normal rows. This is a synthetic result."),
    call("u3", "bash", { command: "npm test -- --reporter=verbose" }),
    result("u3", Array.from({ length: 40 }, (_, i) => `✓ renderer case ${i + 1}: preserves output and wraps long paths /src/components/conversation/tool-execution.ts`).join("\n")),
    { type: "boundary", text: "Approval prompt boundary (simulated)" },
    call("u4", "write", { path: "notes.md", content: "# Verification\nAll checks passed.\n" }), result("u4", "Successfully wrote 34 bytes to notes.md"),
  ] },
  { name: "WIP · batch edits", events: [
    { type: "user", text: "Update the renderer, tests, and documentation." },
    { type: "assistant", text: "I’m applying the changes in parallel." },
    call("we1", "edit", { path: "src/render.ts", edits: [{ oldText: "compact()", newText: "grouped()" }] }),
    call("we2", "edit", { path: "test/render.test.ts", edits: [{ oldText: "completed", newText: "settled" }] }),
    call("we3", "write", { path: "docs/verbosity.md", content: "# Verbosity\nLow and normal display levels.\n" }),
    result("we2", "Successfully replaced text in test/render.test.ts."),
  ] },
  { name: "WIP · batch actions", events: [
    { type: "user", text: "Run the checks while inspecting the remaining files." },
    { type: "assistant", text: "The checks are running. I’m also reading the configuration." },
    call("wa1", "bash", { command: "npm test" }),
    call("wa2", "bash", { command: "npm run typecheck" }),
    call("wa3", "read", { path: "src/config.ts" }),
    call("wa4", "bash", { command: "git diff --check" }),
    result("wa4", ""),
    result("wa3", "export const levels = ['low', 'normal'];"),
  ] },
  { name: "WIP · web searches and fetches", events: [
    { type: "user", text: "Compare the Pi and OpenCode tool displays." },
    { type: "assistant", text: "I’m searching the documentation and fetching a matching page. One search has finished; the other requests are still running." },
    call("ww1", "websearch", { query: "Pi tool rendering expansion" }),
    call("ww2", "websearch", { query: "OpenCode verbosity grouped tool calls" }),
    call("ww3", "websearch", { query: "terminal braille loading indicator" }),
    result("ww2", "Synthetic search result: OpenCode tool display documentation."),
    call("ww4", "webfetch", { url: "https://example.com/renderer-docs" }),
  ] },
  { name: "Parallel progress", events: [
    { type: "user", text: "Inspect these files in parallel." },
    call("p1", "read", { path: "src/model.ts" }), call("p2", "read", { path: "src/render.ts" }), call("p3", "find", { pattern: "*.test.ts" }),
    result("p2", "export const render = () => [];"), result("p3", "test/model.test.ts\ntest/render.test.ts"),
    result("p1", "export type Verbosity = 'low' | 'normal';"),
  ] },
];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string");
  // Imported text must not emit terminal controls or OSC links.
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}
function cleanArguments(value: unknown): unknown {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return value.map(cleanArguments);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), cleanArguments(item)]));
  return value;
}
/** Parse an explicit lab fixture. Unknown event kinds and duplicate call IDs are rejected. */
export function parseFixture(input: unknown): Fixture {
  const root = object(input);
  if (!Array.isArray(root.events) || root.events.length > 2000) throw new Error("Expected at most 2000 events");
  const calls = new Set<string>();
  const results = new Set<string>();
  const events = root.events.map((raw): ReplayEvent => {
    const event = object(raw);
    switch (event.type) {
      case "user": case "assistant": case "boundary": return { type: event.type, text: text(event.text) };
      case "call": {
        const id = text(event.id);
        if (!id || calls.has(id)) throw new Error("Call IDs must be nonempty and unique");
        calls.add(id);
        const args = object(event.args);
        const clean = cleanArguments(args);
        return { type: "call", id, name: text(event.name), args: object(clean) };
      }
      case "result": {
        const id = text(event.id);
        if (!calls.has(id) || results.has(id) || typeof event.error !== "boolean") throw new Error("Result must reference one prior call and have a boolean error field");
        results.add(id);
        return { type: "result", id, text: text(event.text), error: event.error };
      }
      default: throw new Error("Unknown fixture event type");
    }
  });
  return { name: text(root.name), events };
}
