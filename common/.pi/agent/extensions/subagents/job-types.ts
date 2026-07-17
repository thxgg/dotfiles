import type { AgentDefinition, ThinkingLevel } from "./agents.ts";

export type AgentJobStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type AgentBackend = "in-process" | "herdr";
export type NotificationState = "pending" | "delivering" | "delivered" | "consumed";

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

export interface AgentActivity {
  kind: "starting" | "reasoning" | "tool" | "waiting" | "finishing";
  summary: string;
  toolName?: string;
  updatedAt: string;
}

export interface AgentPermissionRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  description: string;
  input: Record<string, unknown>;
  createdAt: string;
  decision?: "allow" | "deny";
  decidedAt?: string;
}

export interface AgentJobResult {
  summary: string;
  structured?: unknown;
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

export interface AgentWorktreeMetadata {
  gitRoot: string;
  parentCwd: string;
  path: string;
  childCwd: string;
  baseCommit: string;
  branch?: string;
  retained?: boolean;
  appliedAt?: string;
  discardedAt?: string;
}

export interface AgentNotification {
  id: string;
  kind: "completion" | "permission";
  state: NotificationState;
  createdAt: string;
  deliveredAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  obsoleteAt?: string;
}

export interface AgentJobOwner {
  sessionId: string;
  sessionFile?: string;
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
  attempt?: number;
  updatedAt?: string;
  endedAt?: string;
  model?: string;
  thinking?: ThinkingLevel;
  result?: AgentJobResult;
  error?: string;
  warnings?: string[];
  activity?: AgentActivity;
  permissionRequests?: AgentPermissionRequest[];
  notifications?: AgentNotification[];
  owner?: AgentJobOwner;
  parentToolCallId?: string;
  herdr?: HerdrJobMetadata;
  worktree?: AgentWorktreeMetadata;
  sessionFile?: string;
  sessionId?: string;
}

export interface AgentJobSpec {
  version: 2;
  jobId: string;
  stateDir: string;
  promptPath: string;
  createdAt: string;
  agent: AgentDefinition;
}

export interface StoredJobState extends AgentJobSnapshot {
  version: 2;
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
