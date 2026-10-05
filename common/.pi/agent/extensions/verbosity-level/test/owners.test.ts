import assert from "node:assert/strict";
import test from "node:test";
import { createReadToolDefinition, initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import verbosity from "../index.ts";

test("resolver composes downstream renderers and never registers executable tools", () => {
  initTheme("dark", false);
  let resolver: ToolRendererResolver | undefined;
  // SAFETY: factory-only test. Session effects are not started, and registering a tool fails.
  verbosity({
    registerFlag() {}, registerCommand() {}, on() {},
    registerTool() { assert.fail("Rendering must not register execution"); },
    registerToolRenderer(value: ToolRendererResolver) { resolver = value; },
  } as unknown as ExtensionAPI);
  assert.ok(resolver);
  const owner = createReadToolDefinition(process.cwd());
  const downstream = { ...owner, renderCall: () => new Text("REMOTE_OWNER_CALL", 0, 0), renderResult: () => new Text("REMOTE_OWNER_RESULT", 0, 0) };
  const wrapped = resolver("read", () => downstream);
  assert.ok(wrapped);
  assert.equal("execute" in wrapped, false);
  assert.equal(resolver("Agent", () => downstream), downstream);
  assert.equal(resolver("workflow", () => downstream), downstream);
  assert.equal(resolver("mcp__fixture__tool", () => downstream), downstream);
  assert.equal(resolver("read", () => undefined), undefined);
  assert.equal(resolver("read", () => downstream), wrapped, "reuse render state across HTML call/result resolution");
  // SAFETY: this test renders without terminal input or tool execution.
  const row = new ToolExecutionComponent("read", "remote", { path: "fixture" }, { showImages: false }, wrapped, { requestRender() {} } as never, process.cwd());
  row.updateResult({ content: [{ type: "text", text: "output" }], isError: false });
  assert.match(row.render(80).join("\n"), /REMOTE_OWNER_CALL/);
  assert.match(row.render(80).join("\n"), /REMOTE_OWNER_RESULT/);
  const replacement = { ...downstream, renderResult: () => new Text("REPLACEMENT", 0, 0) };
  assert.notEqual(resolver("read", () => replacement), wrapped);
});
