import assert from "node:assert/strict";
import { renderersOf } from "./renderers.ts";
import test from "node:test";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withVerbosityRenderers } from "../adapter.ts";
import webToolsExtension from "../../web-tools/index.ts";
import { createWebFetchTool } from "../../web-tools/webfetch.ts";
import { createWebSearchTool } from "../../web-tools/websearch.ts";

test("web tools register independently of verbosity and without cross-extension imports", () => {
  const tools: ToolDefinition[] = [];
  // SAFETY: the web extension only registers its two native tools.
  webToolsExtension({ registerTool(tool: ToolDefinition) { tools.push(tool); } } as ExtensionAPI);
  assert.deepEqual(tools.map(tool => tool.name), ["webfetch", "websearch"]);
  for (const tool of tools) assert.notEqual(tool.renderShell, "self");
});

test("renderer-only web adaptation preserves native collapsed and expanded output", () => {
  initTheme("dark", false);
  for (const make of [createWebFetchTool, createWebSearchTool]) {
    const original = make();
    const wrapped = withVerbosityRenderers(original.name, renderersOf(original), request => request.normal);
    assert.equal("execute" in wrapped, false);
    const args = { url: "https://example.com/", query: "test" };
    const ui = { requestRender() {} };
    // SAFETY: Pi's host component uses only requestRender in these render-only tests.
    const normal = new ToolExecutionComponent(original.name, "default", args, { showImages: false }, renderersOf(original), ui as never, process.cwd());
    const adapted = new ToolExecutionComponent(original.name, "adapted", args, { showImages: false }, wrapped, ui as never, process.cwd());
    const result = { content: [{ type: "text" as const, text: "original output" }], isError: false };
    normal.updateResult(result); adapted.updateResult(result);
    for (const expanded of [false, true]) {
      normal.setExpanded(expanded); adapted.setExpanded(expanded);
      assert.deepEqual(adapted.render(80), normal.render(80));
    }
  }
});
