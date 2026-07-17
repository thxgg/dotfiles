import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_WORKFLOW_AGENT_CALLS, WorkflowController } from "../controller.ts";

test("workflow controller enforces the call budget", async () => {
  const controller = new WorkflowController();
  for (let index = 0; index < MAX_WORKFLOW_AGENT_CALLS; index++) await controller.schedule(async () => index);
  await assert.rejects(controller.schedule(async () => 1), /exceeded/);
  assert.equal(await controller.settle(), true);
});

test("workflow abort reaches active children", async () => {
  const controller = new WorkflowController();
  const task = controller.schedule(async (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
  controller.abort("stop");
  await assert.rejects(task, /stop/);
  assert.equal(await controller.settle(), true);
});
