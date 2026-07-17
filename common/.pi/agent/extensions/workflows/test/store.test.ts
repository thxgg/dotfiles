import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { persistWorkflow, loadWorkflow } from "../store.ts";
import type { WorkflowDetails } from "../model.ts";

test("workflow state and source persist privately and atomically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflows-"));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    const details: WorkflowDetails = { runId: "wf_aabbccddeeff", sessionId: "session", background: true, status: "completed", startedAt: Date.now(), phases: [], agents: [], result: { ok: true }, sourcePath: path.join(root, "pi/workflows/wf_aabbccddeeff/script.js") };
    persistWorkflow(details, "return 1", { value: 2 });
    assert.deepEqual(loadWorkflow(details.runId)?.result, { ok: true });
    if (process.platform !== "win32") assert.equal(fs.statSync(details.sourcePath).mode & 0o777, 0o600);
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
