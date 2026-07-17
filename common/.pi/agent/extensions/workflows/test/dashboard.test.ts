import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkflowDashboard } from "../dashboard.ts";
import type { WorkflowDetails } from "../model.ts";

test("workflow transcript renders as physical rows without embedded newlines", () => {
  const run: WorkflowDetails = {
    runId: "wf_aabbccddeeff", sessionId: "session", background: true, status: "running", startedAt: Date.now(), phases: [], currentPhase: "Review", sourcePath: "/tmp/script.js",
    agents: [{ index: 1, label: "agent-1", state: "running", startedAt: Date.now(), preview: "first\nsecond", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }, transcript: [{ role: "toolResult", text: "one\ntwo\nthree" }] }],
  };
  const dashboard = new WorkflowDashboard({ requestRender() {}, terminal: { rows: 24 } } as any, { bold: (value: string) => value, fg: (_color: string, value: string) => value } as any, { matches: (data: string, action: string) => data === "\r" && action === "tui.select.confirm" } as any, () => new Map([[run.runId, run]]), { async cancel() {}, async restart() {}, async saveReport() { return "saved"; } }, () => {});
  try {
    dashboard.handleInput("\r");
    dashboard.handleInput("\r");
    dashboard.handleInput("\r");
    const lines = dashboard.render(24);
    assert.ok(lines.some((line) => line.includes("one")));
    assert.ok(lines.some((line) => line.includes("three")));
    assert.equal(lines.some((line) => line.includes("\n")), false);
  } finally { dashboard.dispose(); }
});
