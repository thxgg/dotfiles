import type { AgentDefinition, ThinkingLevel } from "./agents.ts";

export type AgentJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type AgentBackend = "in-process" | "herdr";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface ToolCallSummary {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "completed" | "failed";
  error?: string;
}

export interface AgentJobResult {
  summary: string;
  filesRead: string[];
  filesChanged: string[];
  validation: string[];
  artifacts: string[];
  usage: UsageStats;
  toolCalls: ToolCallSummary[];
  stopReason?: string;
  errorMessage?: string;
}

export interface HerdrJobMetadata {
  agentName: string;
  workspaceId: string;
  tabId: string;
  paneId: string;
  terminalId: string;
}

export interface AgentJobSnapshot {
  id: string;
  agent: string;
  source: AgentDefinition["source"];
  task: string;
  cwd: string;
  status: AgentJobStatus;
  background: boolean;
  backend: AgentBackend;
  startedAt: string;
  updatedAt?: string;
  endedAt?: string;
  model?: string;
  thinking?: ThinkingLevel;
  result?: AgentJobResult;
  error?: string;
  warnings?: string[];
  herdr?: HerdrJobMetadata;
  sessionFile?: string;
  sessionId?: string;
}

export interface AgentJobSpec {
  version: 1;
  jobId: string;
  stateDir: string;
  promptPath: string;
  createdAt: string;
  agent: AgentDefinition;
}

export interface StoredJobState extends AgentJobSnapshot {
  version: 1;
}

export interface RuntimeJob extends AgentJobSnapshot {
  controller: AbortController;
  promise?: Promise<AgentJobSnapshot>;
}

export function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

export function snapshotJob(job: RuntimeJob): AgentJobSnapshot {
  const { controller: _controller, promise: _promise, ...snapshot } = job;
  return snapshot;
}

export function isTerminalStatus(status: AgentJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
