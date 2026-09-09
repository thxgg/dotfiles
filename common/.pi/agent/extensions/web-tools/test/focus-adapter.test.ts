import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { withFocusRendering } from "../../focus-mode/adapter.ts";
import { createWebFetchTool } from "../webfetch.ts";
import { createWebSearchTool } from "../websearch.ts";
import { loadFocusAdapter } from "../index.ts";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("optional Focus adapter resolves through Stow file links and tolerates absence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-focus-loader-"));
  try {
    const linked = join(dir, "linked-index.ts");
    await symlink(fileURLToPath(new URL("../index.ts", import.meta.url)), linked);
    const adapter = await loadFocusAdapter(pathToFileURL(linked).href);
    assert.equal(typeof adapter?.withFocusRendering, "function");
    await mkdir(join(dir, "web-tools"));
    const standalone = join(dir, "web-tools", "index.ts");
    await writeFile(standalone, "// Standalone deployment without Focus\n");
    assert.equal(await loadFocusAdapter(pathToFileURL(standalone).href), undefined);
    await mkdir(join(dir, "focus-mode"));
    await writeFile(join(dir, "focus-mode", "adapter.ts"), 'throw new Error("Unavailable optional adapter");');
    assert.equal(await loadFocusAdapter(pathToFileURL(standalone).href), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

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
