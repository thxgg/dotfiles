import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { withFocusRendering } from "../adapter.ts";
import { createWebFetchTool } from "../../../extensions/web-tools/webfetch.ts";
import { createWebSearchTool } from "../../../extensions/web-tools/websearch.ts";

test("Focus adapter preserves web execution, schemas, metadata, and normal rendering", () => {
  initTheme("dark", false);
  for (const make of [createWebFetchTool, createWebSearchTool]) {
    const original = make();
    const wrapped = withFocusRendering({ events: { emit() {} } } as never, original as never);
    for (const key of ["execute", "parameters", "description", "promptSnippet", "promptGuidelines"] as const) assert.equal(wrapped[key], original[key]);
    const args = { url: "https://example.com/", query: "test" };
    const ui = { requestRender() {} };
    const normal = new ToolExecutionComponent(original.name, "normal", args, { showImages: false }, original as never, ui as never, process.cwd());
    const adapted = new ToolExecutionComponent(original.name, "adapted", args, { showImages: false }, wrapped, ui as never, process.cwd());
    const result = { content: [{ type: "text" as const, text: "original output" }], isError: false };
    normal.updateResult(result); adapted.updateResult(result);
    assert.deepEqual(adapted.render(80), normal.render(80));
    normal.setExpanded(true); adapted.setExpanded(true);
    assert.deepEqual(adapted.render(80), normal.render(80));
  }
});
