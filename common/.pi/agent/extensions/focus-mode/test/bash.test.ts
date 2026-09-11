import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters as plain } from "node:util";
import { createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { withFocusRendering, type RenderRequest } from "../adapter.ts";
import { Activity, resultStatus, summary } from "../model.ts";
import { activityComponent } from "../render.ts";
import { registerLocalTools } from "../builtins.ts";

const ui = { requestRender() {} };
test("bash vertical slice executes unchanged, replaces adjacent blocks, expands results inline, splits text, restores native rows", async () => {
  initTheme("dark", false);
  const dir = await mkdtemp(join(tmpdir(), "focus-bash-"));
  try {
    const original = createBashToolDefinition(dir);
    const activity = new Activity(new Set(["bash"]));
    let enabled = true;
    const requests = new Map<string, RenderRequest>();
    const wrapped = withFocusRendering({ events: { emit(_event: string, request: RenderRequest) {
      requests.set(request.context.toolCallId, request);
      request.component = activityComponent(activity, request, () => enabled);
    } } } as never, original);
    for (const key of ["execute", "parameters", "description", "promptSnippet", "promptGuidelines", "constrainedSampling"] as const) assert.equal(wrapped[key], original[key]);
    const commands = ["printf 'status-output\\n'", "printf 'validation-output\\n'; printf 'changed' > changed.txt", "printf 'failure-output\\n'; exit 7"];
    const rows: ToolExecutionComponent[] = [];
    const natives: ToolExecutionComponent[] = [];
    for (let i = 0; i < commands.length; i++) {
      if (i === 2) activity.message({ role: "assistant", content: [{ type: "text", text: "The checks passed." }] });
      const id = `shell${i}`;
      const args = { command: commands[i]! };
      activity.start(id, "bash", args);
      const row = new ToolExecutionComponent("bash", id, args, { showImages: false }, wrapped, ui as never, dir);
      const native = new ToolExecutionComponent("bash", `native${i}`, args, { showImages: false }, original, ui as never, dir);
      let result;
      try { result = { ...await wrapped.execute(id, args, undefined, update => row.updateResult({ ...update, isError: false }, true), undefined as never), isError: false }; }
      catch (error) { result = { content: [{ type: "text" as const, text: (error as Error).message }], isError: true }; }
      activity.finish(id, result);
      row.updateResult(result); native.updateResult(result);
      rows.push(row); natives.push(native);
    }
    assert.equal(await readFile(join(dir, "changed.txt"), "utf8"), "changed");
    const render = () => plain(rows.flatMap(row => row.render(100)).join("\n"));
    assert.match(render(), /Ran 2 commands/);
    assert.match(render(), /FAILED.*Ran 1 command.*1 FAILED/);
    assert.doesNotMatch(render(), /Explor|status-output|validation-output/);
    assert.equal(rows[1]!.render(100).length, 0);
    for (const row of rows) row.setExpanded(true);
    assert.match(render(), /status-output/); assert.match(render(), /validation-output/); assert.match(render(), /failure-output/);
    const click = { type: "click", button: "left", x: 2, y: 0, screenX: 2, screenY: 0, width: 100, height: 10, shift: false, alt: false, ctrl: false } as const;
    assert.equal(activityComponent(activity, requests.get("shell1")!, () => true).handleMouse?.(click)?.handled, true);
    assert.equal(activity.groups[0]!.expanded, true); // Member clicks affect output, not the group.
    assert.equal(activityComponent(activity, requests.get("shell0")!, () => true).handleMouse?.(click)?.handled, true);
    assert.equal(activity.groups[0]!.expanded, false);
    for (const request of requests.values()) request.context.invalidate();
    for (const row of rows) row.setExpanded(false);
    assert.equal(rows[1]!.render(100).length, 0);
    enabled = false;
    for (const request of requests.values()) request.context.invalidate();
    rows.forEach((row, i) => assert.deepEqual(row.render(100), natives[i]!.render(100)));
    for (const width of [1, 12, 38]) for (const row of rows) assert.ok(row.render(width).length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("local bash delegate preserves shell settings, current cwd, session environment, timeout and cancellation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-shell-settings-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ shellPath: "/bin/bash", shellCommandPrefix: "export FOCUS_TEST_PREFIX=prefix" }));
    const tools = new Map<string, any>();
    registerLocalTools({ registerTool(tool: any) { tools.set(tool.name, tool); }, events: { emit() {} } } as never);
    const ctx = { cwd: dir, isProjectTrusted: () => false, sessionManager: { getSessionId: () => "isolated", getSessionFile: () => undefined }, model: { provider: "offline", id: "fixture" }, thinkingLevel: "off" };
    const tool = tools.get("bash");
    const result = await tool.execute("env", { command: "printf '%s|%s|%s|%s' \"$FOCUS_TEST_PREFIX\" \"$PWD\" \"$PI_SESSION_ID\" \"$PI_MODEL\"" }, undefined, undefined, ctx);
    assert.equal(result.content[0].text, `prefix|${dir}|isolated|fixture`);
    await assert.rejects(tool.execute("timeout", { command: "sleep 10", timeout: 0.02 }, undefined, undefined, ctx), /timed out/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(tool.execute("cancel", { command: "printf should-not-run" }, controller.signal, undefined, ctx), /Command aborted/);
    assert.equal(resultStatus({ content: [{ type: "text", text: "partial output\n\nCommand aborted" }], isError: true }), "cancelled");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("edit and write retain native details, preparation and file execution", async () => {
  initTheme("dark", false);
  const dir = await mkdtemp(join(tmpdir(), "focus-mutations-"));
  try {
    const write = createWriteToolDefinition(dir);
    const edit = createEditToolDefinition(dir);
    for (const [original, args] of [[write, { path: "文.txt", content: "before\n" }], [edit, { path: "文.txt", edits: [{ oldText: "before", newText: "after" }] }]] as const) {
      const adapted = withFocusRendering({ events: { emit() {} } } as never, original as any);
      assert.equal(adapted.execute, original.execute);
      assert.equal(adapted.prepareArguments, original.prepareArguments);
      const result = { ...await adapted.execute("mutation", args, undefined, undefined, undefined as never), isError: false };
      const normal = new ToolExecutionComponent(original.name, "native", args, { showImages: false }, original as any, ui as never, dir);
      const row = new ToolExecutionComponent(original.name, "adapted", args, { showImages: false }, adapted, ui as never, dir);
      normal.updateResult(result); row.updateResult(result);
      for (const expanded of [false, true]) {
        normal.setExpanded(expanded); row.setExpanded(expanded);
        assert.deepEqual(row.render(80), normal.render(80));
      }
    }
    assert.equal(await readFile(join(dir, "文.txt"), "utf8"), "after\n");
    const activity = new Activity(new Set(["bash", "edit", "write", "mcp"]));
    for (const name of activity.supported) activity.start(name, name, {});
    assert.match(summary(activity.groups[0]!.calls), /^Activity/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
