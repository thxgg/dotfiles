import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { WorkflowDetails } from "./model.ts";
import { safeStringify, writeFileAtomic } from "./serialization.ts";

const RUN_ID = /^wf_[a-f0-9]{12}$/;
export function workflowRoot(): string { return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "pi", "workflows"); }
export function runDir(runId: string): string { if (!RUN_ID.test(runId)) throw new Error(`Invalid workflow id: ${runId}`); return path.join(workflowRoot(), runId); }
export function persistWorkflow(details: WorkflowDetails, source?: string, args?: unknown): void {
  const dir = runDir(details.runId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (source !== undefined) writeFileAtomic(path.join(dir, "script.js"), source);
  if (args !== undefined) writeFileAtomic(path.join(dir, "args.json"), safeStringify(args, 256 * 1024));
  if (details.result !== undefined) writeFileAtomic(path.join(dir, "result.json"), safeStringify(details.result));
  writeFileAtomic(path.join(dir, "state.json"), safeStringify(details, 2 * 1024 * 1024));
}
export function loadWorkflow(runId: string): WorkflowDetails | undefined {
  try {
    const details = JSON.parse(fs.readFileSync(path.join(runDir(runId), "state.json"), "utf8")) as WorkflowDetails;
    if (details.name === "undefined") details.name = undefined;
    if (details.description === "undefined") details.description = undefined;
    if (details.error === "undefined") details.error = undefined;
    for (const agent of details.agents ?? []) {
      if (agent.error === "undefined") agent.error = undefined;
      if (agent.phase === "undefined") agent.phase = undefined;
      if (agent.model === "undefined") agent.model = undefined;
    }
    return details;
  } catch { return undefined; }
}
export function listWorkflows(): WorkflowDetails[] {
  let entries: string[] = [];
  try { entries = fs.readdirSync(workflowRoot()).filter((entry) => RUN_ID.test(entry)); } catch { return []; }
  return entries.map(loadWorkflow).filter((value): value is WorkflowDetails => Boolean(value)).sort((a, b) => b.startedAt - a.startedAt);
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === "EPERM"; }
}

/** Mark runs from dead extension processes terminal; legacy runs are left untouched. */
export function reconcileOrphanedWorkflows(): WorkflowDetails[] {
  const reconciled: WorkflowDetails[] = [];
  for (const details of listWorkflows()) {
    if (details.status !== "running" || !details.owner || details.owner.pid === process.pid || processExists(details.owner.pid)) continue;
    const finishedAt = Date.now();
    details.status = "failed";
    details.error = "Workflow owner process exited before the run reached a terminal state.";
    details.finishedAt = finishedAt;
    for (const agent of details.agents) if (agent.state === "queued" || agent.state === "running") {
      agent.state = "cancelled";
      agent.error = "Workflow owner process exited before the child completed.";
      agent.finishedAt = finishedAt;
    }
    persistWorkflow(details);
    reconciled.push(details);
  }
  return reconciled;
}
