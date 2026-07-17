import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { persistWorkflow, loadWorkflow, reconcileOrphanedWorkflows } from "../store.ts";
import type { WorkflowDetails } from "../model.ts";

test("workflow state and source persist privately and atomically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflows-"));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    const details: WorkflowDetails = { runId: "wf_aabbccddeeff", sessionId: "session", background: true, status: "completed", startedAt: Date.now(), phases: [], agents: [], result: { ok: true }, sourcePath: path.join(root, "pi/workflows/wf_aabbccddeeff/script.js") };
    persistWorkflow(details, "return 1", { value: 2 });
    assert.deepEqual(loadWorkflow(details.runId)?.result, { ok: true });
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(root, "pi/workflows", details.runId, "state.json"), "utf8")), "name"), false);
    if (process.platform !== "win32") assert.equal(fs.statSync(details.sourcePath).mode & 0o777, 0o600);
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loading legacy state normalizes stringified undefined fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflows-"));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    const runId = "wf_aabbccddeeff";
    const dir = path.join(root, "pi/workflows", runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ runId, sessionId: "s", name: "undefined", description: "undefined", background: true, status: "failed", startedAt: 1, phases: [], agents: [{ error: "undefined", phase: "undefined", model: "undefined" }], error: "undefined", sourcePath: `${dir}/script.js` }));
    const loaded = loadWorkflow(runId)!;
    assert.equal(loaded.name, undefined);
    assert.equal(loaded.description, undefined);
    assert.equal(loaded.error, undefined);
    assert.equal(loaded.agents[0]?.error, undefined);
    assert.equal(loaded.agents[0]?.phase, undefined);
    assert.equal(loaded.agents[0]?.model, undefined);
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reconciliation fails running workflows owned by dead processes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflows-"));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    const details: WorkflowDetails = { runId: "wf_aabbccddeeff", sessionId: "session", owner: { pid: 2_000_000_000, instanceId: "dead" }, background: true, status: "running", startedAt: 1, phases: [], agents: [{ index: 1, label: "child", state: "running", startedAt: 1, preview: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }, transcript: [] }], sourcePath: path.join(root, "pi/workflows/wf_aabbccddeeff/script.js") };
    persistWorkflow(details, "return 1");
    assert.equal(reconcileOrphanedWorkflows().length, 1);
    const loaded = loadWorkflow(details.runId)!;
    assert.equal(loaded.status, "failed");
    assert.equal(loaded.agents[0]?.state, "cancelled");
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
