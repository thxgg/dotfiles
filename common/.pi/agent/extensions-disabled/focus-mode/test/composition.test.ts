import assert from "node:assert/strict";
import test from "node:test";
import { createReadToolDefinition, createLsToolDefinition, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { withFocusRendering, type RenderRequest } from "../adapter.ts";
import { Activity } from "../model.ts";
import { activityComponent } from "../render.ts";

// Exercise Pi's actual host component, not a replacement transcript container.
test("vertical slice: twenty read/ls rows, one live group, native restoration, replay", () => {
  initTheme("dark", false);
  const activity = new Activity(new Set(["read", "ls"]));
  let enabled = true;
  const requests = new Map<string, RenderRequest>();
  const bus = { emit(_name: string, request: RenderRequest) {
    requests.set(request.context.toolCallId, request);
    request.component = activityComponent(activity, request, () => enabled);
  } };
  const read = createReadToolDefinition(process.cwd());
  const ls = createLsToolDefinition(process.cwd());
  assert.equal(typeof read.renderCall, "function");
  assert.equal(typeof read.renderResult, "function");
  const wrapped = [withFocusRendering({ events: bus } as never, read), withFocusRendering({ events: bus } as never, ls)];
  assert.equal(wrapped[0]!.execute, read.execute);
  assert.equal(wrapped[0]!.parameters, read.parameters);
  assert.equal(wrapped[0]!.promptGuidelines, read.promptGuidelines);
  const ui = { requestRender() {} };
  const rows = Array.from({ length: 20 }, (_, i) => {
    const name = i % 2 ? "ls" : "read";
    activity.start(`c${i}`, name, { path: "/tmp" });
    return new ToolExecutionComponent(name, `c${i}`, { path: "/tmp" }, { showImages: false }, wrapped[i % 2], ui as never, process.cwd());
  });
  const lines = () => rows.flatMap(r => r.render(100));
  assert.equal(lines().length, 2); // One spacer, one summary. No per-hidden-row spacers.
  assert.match(lines()[1]!, /20 running/);
  for (let i = 19; i >= 0; i--) {
    activity.finish(`c${i}`, { content: [{ type: "text", text: "original details" }] });
    rows[i]!.updateResult({ content: [{ type: "text", text: "original details" }], isError: false });
    requests.get("c0")!.context.invalidate();
  }
  assert.match(lines()[1]!, /Explored/);
  assert.equal(lines().length, 2);
  activity.groups[0]!.expanded = true;
  assert.match(lines().join("\n"), /✓ Read/);
  enabled = false;
  for (const request of requests.values()) request.context.invalidate();
  const native = new ToolExecutionComponent("read", "native", { path: "/tmp" }, { showImages: false }, read, ui as never, process.cwd());
  native.updateResult({ content: [{ type: "text", text: "original details" }], isError: false });
  assert.deepEqual(rows[0]!.render(100), native.render(100));
  assert.match(lines().join("\n"), /original details/);
  enabled = true;
  const replay = new ToolExecutionComponent("read", "c0", { path: "/tmp" }, { showImages: false }, wrapped[0], ui as never, process.cwd());
  replay.updateResult({ content: [{ type: "text", text: "original details" }], isError: false });
  assert.match(replay.render(100).join("\n"), /Explored/);
});
