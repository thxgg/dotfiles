import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
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

test("background reconciliation yields, cancels safely, and preserves live and completed runs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflow-recovery-"));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    const base: WorkflowDetails = { runId: "wf_001122334455", sessionId: "s", background: true, status: "running", owner: { pid: 2_000_000_000, instanceId: "dead" }, startedAt: 1, phases: [], agents: [], sourcePath: "fixture" };
    const dead = { ...base };
    const live = { ...base, runId: "wf_001122334456", owner: { pid: process.pid, instanceId: "live" } };
    const completed: WorkflowDetails = { ...base, runId: "wf_001122334457", status: "completed", result: "x".repeat(500_000) };
    for (const details of [dead, live, completed]) persistWorkflow(details);
    const controller = new AbortController();
    const pending = reconcileOrphanedWorkflows(controller.signal);
    assert.equal(loadWorkflow(dead.runId)?.status, "running", "no synchronous recovery work");
    controller.abort();
    assert.deepEqual(await pending, { reconciled: [], errors: [] });
    assert.equal(loadWorkflow(dead.runId)?.status, "running");
    const next = reconcileOrphanedWorkflows();
    await yieldToEventLoop();
    assert.equal(loadWorkflow(dead.runId)?.status, "running", "UI work can run before the first recovery write");
    const result = await next;
    assert.deepEqual(result.reconciled.map(run => run.runId), [dead.runId]);
    assert.deepEqual(result.errors, []);
    assert.equal(loadWorkflow(live.runId)?.status, "running");
    assert.deepEqual(loadWorkflow(completed.runId), completed);
    assert.deepEqual((await reconcileOrphanedWorkflows()).reconciled, [], "repeat scan is idempotent");
    const corrupt = path.join(root, "pi/workflows/wf_001122334458");
    fs.mkdirSync(corrupt);
    fs.writeFileSync(path.join(corrupt, "state.json"), "{broken");
    assert.equal((await reconcileOrphanedWorkflows()).errors.length, 1);
    assert.equal(fs.readFileSync(path.join(corrupt, "state.json"), "utf8"), "{broken");
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

test("reconciliation fails running workflows owned by dead processes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflows-"));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    const details: WorkflowDetails = { runId: "wf_aabbccddeeff", sessionId: "session", owner: { pid: 2_000_000_000, instanceId: "dead" }, background: true, status: "running", startedAt: 1, phases: [], agents: [{ index: 1, label: "child", state: "running", startedAt: 1, preview: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }, transcript: [] }], sourcePath: path.join(root, "pi/workflows/wf_aabbccddeeff/script.js") };
    persistWorkflow(details, "return 1");
    const result = await reconcileOrphanedWorkflows();
    assert.equal(result.reconciled.length, 1);
    assert.deepEqual(result.errors, []);
    const loaded = loadWorkflow(details.runId)!;
    assert.equal(loaded.status, "failed");
    assert.equal(loaded.agents[0]?.state, "cancelled");
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
