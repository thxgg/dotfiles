import assert from "node:assert/strict";
import { test } from "node:test";
import { subagentActivityAdapter, workflowActivityAdapter } from "../activity.ts";

test("activity adapters normalize display state without erasing domain identity", () => {
  const subagent = subagentActivityAdapter.project({ version: 1, handle: "aabbccdd", name: "review", prompt: "review", cwd: "/tmp", state: "busy", runDir: "/tmp/run", sessionFile: "/tmp/run/session.jsonl", provider: "openai", model: "example", thinking: "low", hasStarted: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const workflow = workflowActivityAdapter.project({ runId: "wf_aabbccddeeff", sessionId: "session", name: "audit", background: true, status: "running", startedAt: Date.now(), phases: [], currentPhase: "Verify", agents: [], sourcePath: "/tmp/script.js" });
  assert.equal(subagent.kind, "subagent");
  assert.equal(subagent.state, "working");
  assert.equal(workflow.kind, "workflow");
  assert.equal(workflow.state, "working");
  assert.match(workflow.headline, /Verify/);
});
