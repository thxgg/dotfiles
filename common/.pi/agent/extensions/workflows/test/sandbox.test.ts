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

test("sandbox rejects workflows that return with unawaited agents", async () => {
  await assert.rejects(runWorkflowSandbox({
    source: `agent('forgotten'); return 'too early'`, args: undefined, cwd: process.cwd(), signal: new AbortController().signal,
    onPhase() {}, onAgent: async () => new Promise(() => {}),
  }), /unawaited agent/);
});

test("sandbox exposes neither process nor require globals", async () => {
  const result = await runWorkflowSandbox({
    source: `return typeof process + ':' + typeof require`, args: undefined, cwd: process.cwd(), signal: new AbortController().signal,
    onPhase() {}, onAgent: async () => ({ ok: true, output: "" }),
  });
  assert.equal(result, "undefined:undefined");
});
