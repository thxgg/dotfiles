import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { withVerbosityRendering } from "../adapter.ts";
import webToolsExtension from "../../../extensions/web-tools/index.ts";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

test("web registration groups by default and supports explicit opt-out", async () => {
  const previous = process.env.PI_VERBOSITY_WEB;
  try {
    for (const enabled of [false, true]) {
      if (enabled) delete process.env.PI_VERBOSITY_WEB;
      else process.env.PI_VERBOSITY_WEB = "0";
      const tools: ToolDefinition[] = [];
      const subscriptions: string[] = [];
      const api = {
        registerTool(tool: ToolDefinition) { tools.push(tool); },
        events: { on(name: string) { subscriptions.push(name); return () => {}; }, emit() {} },
        on() {},
      };
      // SAFETY: registration uses only the narrow methods supplied above.
      await webToolsExtension(api as unknown as ExtensionAPI);
      assert.deepEqual(tools.map(tool => tool.name), ["webfetch", "websearch"]);
      assert.equal(subscriptions.length, enabled ? 1 : 0);
      for (const tool of tools) assert.equal(tool.renderShell === "self", enabled);
    }
  } finally {
    if (previous === undefined) delete process.env.PI_VERBOSITY_WEB;
    else process.env.PI_VERBOSITY_WEB = previous;
  }
});
import { createWebFetchTool } from "../../../extensions/web-tools/webfetch.ts";
import { createWebSearchTool } from "../../../extensions/web-tools/websearch.ts";

test("Focus adapter preserves web execution, schemas, metadata, and normal rendering", () => {
  initTheme("dark", false);
  for (const make of [createWebFetchTool, createWebSearchTool]) {
    const original = make();
    const wrapped = withVerbosityRendering({ events: { emit() {} } } as never, original as never);
    for (const key of ["execute", "parameters", "description", "promptSnippet", "promptGuidelines"] as const) assert.equal(wrapped[key], original[key]);
    const args = { url: "https://example.com/", query: "test" };
    const ui = { requestRender() {} };
    const normal = new ToolExecutionComponent(original.name, "default", args, { showImages: false }, original as never, ui as never, process.cwd());
    const adapted = new ToolExecutionComponent(original.name, "adapted", args, { showImages: false }, wrapped, ui as never, process.cwd());
    const result = { content: [{ type: "text" as const, text: "original output" }], isError: false };
    normal.updateResult(result); adapted.updateResult(result);
    assert.deepEqual(adapted.render(80), normal.render(80));
    normal.setExpanded(true); adapted.setExpanded(true);
    assert.deepEqual(adapted.render(80), normal.render(80));
  }
});
