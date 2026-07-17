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
  try { return JSON.parse(fs.readFileSync(path.join(runDir(runId), "state.json"), "utf8")) as WorkflowDetails; } catch { return undefined; }
}
export function listWorkflows(): WorkflowDetails[] {
  let entries: string[] = [];
  try { entries = fs.readdirSync(workflowRoot()).filter((entry) => RUN_ID.test(entry)); } catch { return []; }
  return entries.map(loadWorkflow).filter((value): value is WorkflowDetails => Boolean(value)).sort((a, b) => b.startedAt - a.startedAt);
}
