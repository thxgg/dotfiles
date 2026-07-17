import * as os from "node:os";

export interface WorkflowUsage {
  input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number; contextTokens?: number;
}
export interface TranscriptEntry {
  role: "user" | "assistant" | "thinking" | "tool" | "toolResult";
  text: string;
  name?: string;
  isError?: boolean;
  timestamp?: number;
  durationMs?: number;
}
export interface WorkflowAgentRecord {
  index: number;
  label: string;
  phase?: string;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  model?: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  preview: string;
  usage: WorkflowUsage;
  transcript: TranscriptEntry[];
}
export interface WorkflowDetails {
  runId: string;
  sessionId: string;
  owner?: { pid: number; instanceId: string };
  name?: string;
  description?: string;
  background: boolean;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  phases: Array<{ title: string; detail?: string }>;
  currentPhase?: string;
  agents: WorkflowAgentRecord[];
  result?: unknown;
  error?: string;
  sourcePath: string;
}
export function emptyUsage(): WorkflowUsage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }; }
export function formatElapsed(start: number, end = Date.now()): string {
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}
export function shortenHome(value: string): string { return value.startsWith(os.homedir()) ? `~${value.slice(os.homedir().length)}` : value; }
