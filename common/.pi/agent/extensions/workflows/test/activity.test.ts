import assert from "node:assert/strict";
import { test } from "node:test";
import { subagentActivityAdapter, workflowActivityAdapter } from "../activity.ts";

test("activity adapters normalize display state without erasing domain identity", () => {
  const subagent = subagentActivityAdapter.project({ id: "agent-aabbccdd", agent: "reviewer", source: "builtin", task: "review", cwd: "/tmp", status: "waiting", background: true, backend: "herdr", startedAt: new Date().toISOString() });
  const workflow = workflowActivityAdapter.project({ runId: "wf_aabbccddeeff", sessionId: "session", name: "audit", background: true, status: "running", startedAt: Date.now(), phases: [], currentPhase: "Verify", agents: [], sourcePath: "/tmp/script.js" });
  assert.equal(subagent.kind, "subagent");
  assert.equal(subagent.state, "needs-input");
  assert.equal(workflow.kind, "workflow");
  assert.equal(workflow.state, "working");
  assert.match(workflow.headline, /Verify/);
});
