import assert from "node:assert/strict";
import { test } from "node:test";
import { runWorkflowSandbox } from "../sandbox.ts";

test("sandbox runs phases and parallel agent calls", async () => {
  const phases: string[] = [];
  const result = await runWorkflowSandbox({
    source: `phase('Gather'); const values = await parallel([() => agent('a'), () => agent('b')]); return values.map(v => v.output);`,
    args: undefined,
    cwd: process.cwd(),
    signal: new AbortController().signal,
    onPhase: (phase) => phases.push(phase),
    onAgent: async (prompt) => ({ ok: true, output: prompt.toUpperCase() }),
  });
  assert.deepEqual(phases, ["Gather"]);
  assert.deepEqual(result, ["A", "B"]);
});

test("sandbox accepts directly-started agent promises in parallel", async () => {
  const result = await runWorkflowSandbox({
    source: `return await parallel([agent('a'), agent('b')]);`,
    args: undefined,
    cwd: process.cwd(),
    signal: new AbortController().signal,
    onPhase() {},
    onAgent: async (prompt) => ({ ok: true, output: prompt.toUpperCase() }),
  });
  assert.equal(JSON.stringify(result), JSON.stringify([{ ok: true, output: "A" }, { ok: true, output: "B" }]));
});

test("sandbox invokes mixed promise and thunk inputs", async () => {
  const prompts: string[] = [];
  const result = await runWorkflowSandbox({
    source: `return await parallel([agent('a'), () => agent('b')]);`,
    args: undefined,
    cwd: process.cwd(),
    signal: new AbortController().signal,
    onPhase() {},
    onAgent: async (prompt) => { prompts.push(prompt); return { ok: true, output: prompt.toUpperCase() }; },
  });
  assert.deepEqual(prompts.sort(), ["a", "b"]);
  assert.equal(JSON.stringify(result), JSON.stringify([{ ok: true, output: "A" }, { ok: true, output: "B" }]));
});

test("sandbox supports phase callbacks with workflow-worker options", async () => {
  const phases: string[] = [];
  const calls: Array<{ prompt: string; label: unknown }> = [];
  const result = await runWorkflowSandbox({
    source: `return await phase('Review', async () => { const value = await agent('Inspect changes', { label: 'review' }); return value.output; });`,
    args: undefined,
    cwd: process.cwd(),
    signal: new AbortController().signal,
    onPhase: (phase) => phases.push(phase),
    onAgent: async (prompt, options) => { calls.push({ prompt, label: options.label }); return { ok: true, output: "reviewed" }; },
  });
  assert.deepEqual(phases, ["Review"]);
  assert.deepEqual(calls, [{ prompt: "Inspect changes", label: "review" }]);
  assert.equal(result, "reviewed");
});

test("sandbox rejects named workflow agent types", async () => {
  await assert.rejects(runWorkflowSandbox({
    source: `return await agent('reviewer', { task: 'Inspect changes' })`, args: undefined, cwd: process.cwd(), signal: new AbortController().signal,
    onPhase() {}, onAgent: async () => ({ ok: true, output: "" }),
  }), /Workflow agent types are not supported/);
  await assert.rejects(runWorkflowSandbox({
    source: `return await agent('Inspect changes', { agentType: 'reviewer' })`, args: undefined, cwd: process.cwd(), signal: new AbortController().signal,
    onPhase() {}, onAgent: async () => ({ ok: true, output: "" }),
  }), /Workflow agent types are not supported/);
});

test("sandbox rejects workflows that return with unawaited agents", async () => {
  await assert.rejects(runWorkflowSandbox({
    source: `agent('forgotten'); return 'too early'`, args: undefined, cwd: process.cwd(), signal: new AbortController().signal,
    onPhase() {}, onAgent: async () => new Promise(() => {}),
  }), /unawaited agent/);
});

test("sandbox rejects completed but unawaited agents", async () => {
  await assert.rejects(runWorkflowSandbox({
    source: `agent('forgotten'); await agent('observed'); return 'too early'`, args: undefined, cwd: process.cwd(), signal: new AbortController().signal,
    onPhase() {}, onAgent: async (prompt) => ({ ok: true, output: prompt }),
  }), /1 unawaited agent/);
});

test("sandbox exposes neither process nor require globals", async () => {
  const result = await runWorkflowSandbox({
    source: `return typeof process + ':' + typeof require`, args: undefined, cwd: process.cwd(), signal: new AbortController().signal,
    onPhase() {}, onAgent: async () => ({ ok: true, output: "" }),
  });
  assert.equal(result, "undefined:undefined");
});
