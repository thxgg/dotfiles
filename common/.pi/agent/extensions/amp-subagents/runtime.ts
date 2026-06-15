import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentToolUpdateCallback,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Static } from "typebox";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  type AgentDefinition,
  type AgentDiscoveryResult,
  type AgentScope,
  type ThinkingLevel,
  discoverAgents,
  formatAgentList,
  getActiveToolNames,
  getAgentByName,
} from "./agents.ts";
import { createPermissionGuard } from "./readonly.ts";

const AGENT_ACTIONS = ["run", "list", "result", "cancel"] as const;
const AGENT_SCOPES = ["default", "builtin", "user", "project", "all"] as const;
const JOB_HISTORY_LIMIT = 50;

const AgentToolSchema = Type.Object({
  action: Type.Optional(StringEnum([...AGENT_ACTIONS], {
    description: "run a subagent, list agents/jobs, get a background result, or cancel a background job. Default: run when agent/task are provided, otherwise list.",
  })),
  agent: Type.Optional(Type.String({ description: "Agent name to run, for example agent, search, oracle, librarian, reviewer, or painter." })),
  task: Type.Optional(Type.String({ description: "Self-contained task for the child agent." })),
  background: Type.Optional(Type.Boolean({ description: "Run without blocking and return a job id. Defaults to true only for agents whose definition sets background: true." })),
  jobId: Type.Optional(Type.String({ description: "Background job id for result/cancel actions." })),
  agentScope: Type.Optional(StringEnum([...AGENT_SCOPES], {
    description: "Agent definition scopes to search. default = built-in/package plus user agents. project/all require explicit opt-in and confirmation.",
    default: "default",
  })),
  includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden agents in list output. Default false." })),
  confirmProjectAgents: Type.Optional(Type.Boolean({ description: "Prompt before running project-local agents. Default true when UI is available." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the child agent. Defaults to the parent cwd." })),
}, { additionalProperties: false });

export type AgentToolParams = Static<typeof AgentToolSchema>;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

interface ToolCallSummary {
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

export interface AgentJobSnapshot {
  id: string;
  agent: string;
  source: AgentDefinition["source"];
  task: string;
  cwd: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  background: boolean;
  startedAt: string;
  endedAt?: string;
  model?: string;
  thinking?: ThinkingLevel;
  result?: AgentJobResult;
  error?: string;
}

interface AgentJob extends AgentJobSnapshot {
  controller: AbortController;
  promise?: Promise<AgentJobSnapshot>;
}

export interface AgentToolDetails {
  action: AgentAction;
  agents?: Array<Pick<AgentDefinition, "name" | "description" | "source" | "hidden" | "model" | "thinking">>;
  jobs?: AgentJobSnapshot[];
  projectAgentsDir?: string | null;
}

const jobs = new Map<string, AgentJob>();

function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function snapshotJob(job: AgentJob): AgentJobSnapshot {
  return {
    id: job.id,
    agent: job.agent,
    source: job.source,
    task: job.task,
    cwd: job.cwd,
    status: job.status,
    background: job.background,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    model: job.model,
    thinking: job.thinking,
    result: job.result,
    error: job.error,
  };
}

export function getJobSnapshots(): AgentJobSnapshot[] {
  return Array.from(jobs.values())
    .map(snapshotJob)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function getRunningJobCount(): number {
  return getJobSnapshots().filter((job) => job.status === "running" || job.status === "queued").length;
}

export function cancelJob(jobId: string, reason = "Cancelled by parent agent."): AgentJobSnapshot | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  if (job.status === "running" || job.status === "queued") {
    job.status = "cancelled";
    job.error = reason;
    job.endedAt = new Date().toISOString();
    job.controller.abort(reason);
  }
  return snapshotJob(job);
}

function pruneJobs(): void {
  const all = Array.from(jobs.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const overflow = all.length - JOB_HISTORY_LIMIT;
  if (overflow <= 0) return;
  for (const job of all.slice(0, overflow)) {
    if (job.status === "running" || job.status === "queued") continue;
    jobs.delete(job.id);
  }
}

export function abortRunningJobs(reason = "Session shutdown"): void {
  for (const job of jobs.values()) {
    if (job.status === "running" || job.status === "queued") {
      job.error = reason;
      job.status = "cancelled";
      job.endedAt = new Date().toISOString();
      job.controller.abort(reason);
    }
  }
}

function textContent(text: string) {
  return { type: "text" as const, text };
}

function getMessageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n");
}

function addUsage(usage: UsageStats, message: any): void {
  const msgUsage = message?.usage;
  if (!msgUsage) return;
  usage.input += Number(msgUsage.input ?? 0);
  usage.output += Number(msgUsage.output ?? 0);
  usage.cacheRead += Number(msgUsage.cacheRead ?? 0);
  usage.cacheWrite += Number(msgUsage.cacheWrite ?? 0);
  usage.cost += Number(msgUsage.cost?.total ?? msgUsage.cost ?? 0);
  usage.contextTokens = Number(msgUsage.totalTokens ?? msgUsage.contextTokens ?? usage.contextTokens);
  usage.turns += 1;
}

function formatModel(model: Model<any> | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

function resolveModel(ctx: ExtensionContext, modelSpec: string | undefined): Model<any> | undefined {
  if (!modelSpec) return undefined;
  const slashIndex = modelSpec.indexOf("/");
  if (slashIndex === -1) return ctx.modelRegistry.find(ctx.model?.provider ?? "openai-codex", modelSpec);
  const provider = modelSpec.slice(0, slashIndex);
  const modelId = modelSpec.slice(slashIndex + 1);
  return ctx.modelRegistry.find(provider, modelId);
}

function composeAgentPrompt(agent: AgentDefinition): string {
  const metadata = [
    `Name: ${agent.name}`,
    `Return mode: ${agent.returnMode ?? "summary"}`,
    `Source: ${agent.source}`,
    agent.maxTurns ? `Max turns: ${agent.maxTurns}` : undefined,
  ].filter(Boolean).join("\n");

  return [
    `# Subagent Definition\n${metadata}`,
    agent.systemPrompt,
    "# Parent/Child Contract\nYou are running as a child Pi session. Treat the parent Pi agent as your caller. Return the requested concise result; do not continue with unrelated work.",
  ].join("\n\n");
}

function createSettingsManager(cwd: string, agent: AgentDefinition): SettingsManager {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  if (agent.compaction) {
    settingsManager.applyOverrides({
      compaction: {
        enabled: agent.compaction.enabled,
        reserveTokens: agent.compaction.reserveTokens,
        keepRecentTokens: agent.compaction.keepRecentTokens,
      },
    } as any);
  }
  return settingsManager;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function collectPathsFromTool(name: string, args: Record<string, unknown>, filesRead: Set<string>, filesChanged: Set<string>): void {
  const pathValue = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
  if (!pathValue) return;

  if (name === "edit" || name === "write") filesChanged.add(pathValue);
  if (["read", "grep", "find", "ls"].includes(name)) filesRead.add(pathValue);
}

function collectArtifacts(result: unknown, artifacts: Set<string>): void {
  const details = asRecord(asRecord(result).details);
  const images = details.images;
  if (!Array.isArray(images)) return;
  for (const image of images) {
    const imagePath = asRecord(image).path;
    if (typeof imagePath === "string") artifacts.add(imagePath);
  }
}

function isValidationCommand(command: string): boolean {
  return /\b(test|tests|check|lint|typecheck|tsc|pytest|vitest|jest|cargo\s+test|go\s+test|npm\s+test|pnpm\s+test|bun\s+test)\b/i.test(command);
}

function emitJobUpdate(job: AgentJob, onUpdate: AgentToolUpdateCallback<AgentToolDetails> | undefined): void {
  onUpdate?.({
    content: [textContent(formatJobSummary(snapshotJob(job)))],
    details: { action: "run", jobs: [snapshotJob(job)] },
  });
}

async function runJob(job: AgentJob, agent: AgentDefinition, ctx: ExtensionContext, onUpdate?: AgentToolUpdateCallback<AgentToolDetails>): Promise<AgentJobSnapshot> {
  const usage = emptyUsage();
  const toolCalls = new Map<string, ToolCallSummary>();
  const filesRead = new Set<string>();
  const filesChanged = new Set<string>();
  const validation = new Set<string>();
  const artifacts = new Set<string>();
  let finalSummary = "";
  let stopReason: string | undefined;
  let errorMessage: string | undefined;
  let maxTurnAbort = false;
  let sessionAbort: (() => Promise<void>) | undefined;

  const model = resolveModel(ctx, agent.model);
  if (agent.model && !model) {
    throw new Error(`Model not found for subagent ${agent.name}: ${agent.model}`);
  }
  job.model = formatModel(model ?? ctx.model);
  job.thinking = agent.thinking;
  job.status = "running";
  emitJobUpdate(job, onUpdate);

  const cwd = job.cwd;
  const agentDir = getAgentDir();
  const settingsManager = createSettingsManager(cwd, agent);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    appendSystemPromptOverride: (base) => [...base, composeAgentPrompt(agent)],
    extensionFactories: [createPermissionGuard(agent)],
  });
  await loader.reload();

  const activeTools = getActiveToolNames(agent);
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    model: model ?? ctx.model,
    modelRegistry: ctx.modelRegistry,
    thinkingLevel: agent.thinking,
    tools: activeTools,
  });

  sessionAbort = () => session.abort();
  const abortChild = () => {
    void session.abort();
  };
  job.controller.signal.addEventListener("abort", abortChild, { once: true });

  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "tool_execution_start") {
      const args = asRecord(event.args);
      const call: ToolCallSummary = {
        id: String(event.toolCallId ?? `${event.toolName}-${toolCalls.size + 1}`),
        name: String(event.toolName ?? "unknown"),
        args,
        status: "running",
      };
      toolCalls.set(call.id, call);
      collectPathsFromTool(call.name, args, filesRead, filesChanged);
      if (call.name === "bash" && typeof args.command === "string" && isValidationCommand(args.command)) {
        validation.add(args.command);
      }
      emitJobUpdate(job, onUpdate);
    }

    if (event.type === "tool_execution_end") {
      const id = String(event.toolCallId ?? "");
      const call = toolCalls.get(id);
      if (call) {
        call.status = event.isError ? "failed" : "completed";
        if (event.isError) call.error = getMessageText(event.result) || "tool failed";
      }
      collectArtifacts(event.result, artifacts);
      emitJobUpdate(job, onUpdate);
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      const text = getMessageText(event.message).trim();
      if (text) finalSummary = text;
      addUsage(usage, event.message);
      if (event.message.stopReason) stopReason = event.message.stopReason;
      if (event.message.errorMessage) errorMessage = event.message.errorMessage;
      emitJobUpdate(job, onUpdate);
    }

    if (event.type === "turn_end" && agent.maxTurns && Number(event.turnIndex ?? 0) + 1 >= agent.maxTurns) {
      maxTurnAbort = true;
      void session.abort();
    }
  });

  try {
    await session.prompt(`Task: ${job.task}`);
    if (maxTurnAbort) {
      throw new Error(`Subagent ${agent.name} stopped after reaching maxTurns=${agent.maxTurns}.`);
    }
    if (errorMessage || stopReason === "error") {
      throw new Error(errorMessage || `Subagent stopped with reason: ${stopReason}`);
    }

    job.status = "completed";
    job.result = {
      summary: finalSummary || "(no output)",
      filesRead: Array.from(filesRead).sort(),
      filesChanged: Array.from(filesChanged).sort(),
      validation: Array.from(validation),
      artifacts: Array.from(artifacts).sort(),
      usage,
      toolCalls: Array.from(toolCalls.values()),
      stopReason,
      errorMessage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job.controller.signal.aborted || maxTurnAbort || /aborted/i.test(message)) {
      job.status = "cancelled";
    } else {
      job.status = "failed";
    }
    job.error = message;
    job.result = {
      summary: finalSummary || message,
      filesRead: Array.from(filesRead).sort(),
      filesChanged: Array.from(filesChanged).sort(),
      validation: Array.from(validation),
      artifacts: Array.from(artifacts).sort(),
      usage,
      toolCalls: Array.from(toolCalls.values()),
      stopReason,
      errorMessage: message,
    };
  } finally {
    job.controller.signal.removeEventListener("abort", abortChild);
    unsubscribe();
    session.dispose();
    job.endedAt = new Date().toISOString();
    emitJobUpdate(job, onUpdate);
    pruneJobs();
  }

  return snapshotJob(job);
}

function makeJob(agent: AgentDefinition, task: string, cwd: string, background: boolean): AgentJob {
  const now = new Date().toISOString();
  return {
    id: `agent-${randomUUID().slice(0, 8)}`,
    agent: agent.name,
    source: agent.source,
    task,
    cwd,
    status: "queued",
    background,
    startedAt: now,
    model: agent.model,
    thinking: agent.thinking,
    controller: new AbortController(),
  };
}

function formatJobSummary(job: AgentJobSnapshot): string {
  const header = `[${job.id}] ${job.agent} ${job.status}`;
  if (job.status === "completed") return `${header}\n${job.result?.summary ?? "(no output)"}`;
  if (job.status === "failed" || job.status === "cancelled") return `${header}\n${job.error ?? job.result?.errorMessage ?? "stopped"}`;
  return `${header}\nTask: ${job.task}`;
}

function formatJobs(jobsToFormat: AgentJobSnapshot[]): string {
  if (jobsToFormat.length === 0) return "No subagent jobs.";
  return jobsToFormat
    .map((job) => {
      const elapsed = job.endedAt ? `${job.startedAt} → ${job.endedAt}` : `started ${job.startedAt}`;
      return `- ${job.id} ${job.status} ${job.agent} (${job.source}) ${elapsed}\n  ${job.task}`;
    })
    .join("\n");
}

function listAgents(discovery: AgentDiscoveryResult, includeHidden: boolean): AgentToolDetails {
  return {
    action: "list",
    agents: discovery.agents
      .filter((agent) => includeHidden || !agent.hidden)
      .map((agent) => ({
        name: agent.name,
        description: agent.description,
        source: agent.source,
        hidden: agent.hidden,
        model: agent.model,
        thinking: agent.thinking,
      })),
    jobs: getJobSnapshots(),
    projectAgentsDir: discovery.projectAgentsDir,
  };
}

async function confirmProjectAgentIfNeeded(agent: AgentDefinition, params: AgentToolParams, discovery: AgentDiscoveryResult, ctx: ExtensionContext): Promise<boolean> {
  if (agent.source !== "project") return true;
  if (params.confirmProjectAgents === false || !ctx.hasUI) return true;
  return ctx.ui.confirm(
    "Run project-local subagent?",
    `Agent: ${agent.name}\nSource: ${agent.filePath}\nProject agents are repo-controlled prompts. Only continue for repositories you trust.\nProject agents dir: ${discovery.projectAgentsDir ?? "(unknown)"}`,
  );
}

function resolveAction(params: AgentToolParams): AgentAction {
  if (params.action) return params.action as AgentAction;
  if (params.agent || params.task) return "run";
  return "list";
}

function resolveBackground(agent: AgentDefinition, requested: boolean | undefined): boolean {
  if (requested !== undefined) return requested;
  return agent.background === true;
}

function resolveCwd(parentCwd: string, requested: string | undefined): string {
  if (!requested) return parentCwd;
  return path.resolve(parentCwd, requested);
}

export function createAgentTool() {
  return {
    name: "Agent",
    label: "Agent",
    description: "Run Amp-style Pi subagents with isolated child sessions. Supports foreground runs, background jobs, result retrieval, cancellation, and agent listing.",
    promptSnippet: "Run an isolated child Pi subagent (agent/search/oracle/librarian/reviewer/painter) for self-contained work",
    promptGuidelines: [
      "Use Agent when a task can be delegated to an isolated subagent and summarized back to the parent.",
      "Use Agent with background=true for long research, image generation, or independent checks that should not block the parent.",
      "Do not ask subagents to spawn other agents unless a user explicitly requests a workflow that requires it.",
    ],
    parameters: AgentToolSchema,
    async execute(_toolCallId: string, params: AgentToolParams, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<AgentToolDetails> | undefined, ctx: ExtensionContext) {
      const action = resolveAction(params);
      const scope = (params.agentScope ?? "default") as AgentScope;
      const includeHidden = params.includeHidden === true;
      const discovery = discoverAgents(ctx.cwd, scope);

      const updateSubagentStatus = () => {
        const running = getRunningJobCount();
        ctx.ui.setStatus("subagents", running > 0 ? `agents:${running}` : undefined);
      };

      if (action === "list") {
        updateSubagentStatus();
        const details = listAgents(discovery, includeHidden);
        return {
          content: [textContent(`Available agents:\n${formatAgentList(discovery.agents, includeHidden)}\n\nJobs:\n${formatJobs(details.jobs ?? [])}`)],
          details,
        };
      }

      if (action === "result") {
        if (!params.jobId) return { content: [textContent("jobId is required for action=result.")], details: { action, jobs: [] } };
        const job = jobs.get(params.jobId);
        if (!job) return { content: [textContent(`No subagent job found: ${params.jobId}`)], details: { action, jobs: [] } };
        updateSubagentStatus();
        const snapshot = snapshotJob(job);
        return { content: [textContent(formatJobSummary(snapshot))], details: { action, jobs: [snapshot] } };
      }

      if (action === "cancel") {
        if (!params.jobId) return { content: [textContent("jobId is required for action=cancel.")], details: { action, jobs: [] } };
        const snapshot = cancelJob(params.jobId);
        if (!snapshot) return { content: [textContent(`No subagent job found: ${params.jobId}`)], details: { action, jobs: [] } };
        const running = getRunningJobCount();
        ctx.ui.setStatus("subagents", running > 0 ? `agents:${running}` : undefined);
        return { content: [textContent(formatJobSummary(snapshot))], details: { action, jobs: [snapshot] } };
      }

      if (!params.agent || !params.task) {
        return { content: [textContent("agent and task are required for action=run.")], details: { action, jobs: [] } };
      }

      const agent = getAgentByName(discovery.agents, params.agent, true);
      if (!agent) {
        return {
          content: [textContent(`Unknown agent: ${params.agent}\n\n${formatAgentList(discovery.agents, includeHidden)}`)],
          details: listAgents(discovery, includeHidden),
        };
      }

      const ok = await confirmProjectAgentIfNeeded(agent, params, discovery, ctx);
      if (!ok) {
        return { content: [textContent("Canceled: project-local subagent was not approved.")], details: { action, jobs: [] } };
      }

      const background = resolveBackground(agent, params.background);
      if (background && agent.background === false) {
        return { content: [textContent(`Agent ${agent.name} does not allow background execution.`)], details: { action, jobs: [] } };
      }

      const job = makeJob(agent, params.task, resolveCwd(ctx.cwd, params.cwd), background);
      jobs.set(job.id, job);

      updateSubagentStatus();

      const parentAbort = () => job.controller.abort("Parent Agent tool call was aborted.");
      if (!background && signal) {
        if (signal.aborted) parentAbort();
        else signal.addEventListener("abort", parentAbort, { once: true });
      }

      const promise = runJob(job, agent, ctx, background ? undefined : onUpdate)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          job.status = job.controller.signal.aborted ? "cancelled" : "failed";
          job.error = message;
          job.endedAt = new Date().toISOString();
          return snapshotJob(job);
        })
        .finally(() => {
          if (signal) signal.removeEventListener("abort", parentAbort);
          // Background jobs may settle after the tool call context has gone
          // stale. The next Agent list/result/cancel call refreshes status from
          // the current context instead of touching a captured old ctx here.
          if (!background) updateSubagentStatus();
        });
      job.promise = promise;

      if (background) {
        void promise;
        const snapshot = snapshotJob(job);
        return {
          content: [textContent(`Started background subagent job ${job.id} (${agent.name}). Use Agent action=result with jobId=${job.id} to retrieve it, or action=cancel to stop it.`)],
          details: { action, jobs: [snapshot] },
        };
      }

      const snapshot = await promise;
      return {
        content: [textContent(formatJobSummary(snapshot))],
        details: { action, jobs: [snapshot] },
      };
    },
    renderCall(args: AgentToolParams, theme: any) {
      const action = args.action ?? (args.agent || args.task ? "run" : "list");
      let text = theme.fg("toolTitle", theme.bold("Agent ")) + theme.fg("accent", action);
      if (args.agent) text += theme.fg("muted", ` ${args.agent}`);
      if (args.background) text += theme.fg("warning", " background");
      if (args.jobId) text += theme.fg("muted", ` ${args.jobId}`);
      return new Text(text, 0, 0);
    },
    renderResult(result: { content: Array<{ type: string; text?: string }>; details?: AgentToolDetails }, { expanded }: { expanded: boolean }, theme: any) {
      const details = result.details;
      if (!details?.jobs?.length && !details?.agents?.length) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text ?? "" : "", 0, 0);
      }

      if (details.action === "list") {
        const agentCount = details.agents?.length ?? 0;
        const jobCount = details.jobs?.length ?? 0;
        let text = `${theme.fg("toolTitle", "Agents")} ${theme.fg("accent", String(agentCount))} ${theme.fg("muted", `jobs ${jobCount}`)}`;
        if (expanded) {
          const content = result.content[0];
          text += `\n${content?.type === "text" ? content.text ?? "" : ""}`;
        }
        return new Text(text, 0, 0);
      }

      const job = details.jobs?.[0];
      if (!job) return new Text("Agent: no job", 0, 0);
      const icon = job.status === "completed" ? theme.fg("success", "✓") : job.status === "failed" ? theme.fg("error", "✗") : job.status === "cancelled" ? theme.fg("warning", "◼") : theme.fg("warning", "⏳");
      let text = `${icon} ${theme.fg("toolTitle", job.agent)} ${theme.fg("accent", job.status)} ${theme.fg("muted", job.id)}`;
      if (job.result?.usage?.turns) text += theme.fg("dim", ` ${job.result.usage.turns} turns`);
      if (job.result?.summary && (expanded || job.status !== "running")) {
        text += `\n${job.result.summary}`;
      } else if (job.error) {
        text += `\n${theme.fg("error", job.error)}`;
      }
      return new Text(text, 0, 0);
    },
  };
}

export { AgentToolSchema };
