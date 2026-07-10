import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import {
  type AgentDefinition, type AgentDiscoveryResult, type AgentScope,
  discoverAgents, formatAgentList, getAgentByName,
} from "./agents.ts";
import { runInProcessJob } from "./in-process-runtime.ts";
import { composeAgentPrompt } from "./prompt.ts";
import { jobStore } from "./job-store.ts";
import type { AgentJobSnapshot, RuntimeJob } from "./job-types.ts";
import { isTerminalStatus, snapshotJob } from "./job-types.ts";
import {
  cancelHerdrJob, cleanupHerdrJobs, closeHerdrJob, createJobSpec,
  focusHerdrJob, launchHerdrJob, messageHerdrJob, shouldUseHerdr, waitForHerdrJob,
} from "./herdr-runtime.ts";
import { HerdrClient } from "./herdr-client.ts";
import { applyAgentWorktree, createAgentWorktree, discardAgentWorktree, retainAgentWorktree } from "./worktree.ts";
import { ensureTerminalNotification } from "./notifications.ts";

const AGENT_ACTIONS = ["run", "list", "result", "cancel", "focus", "close", "cleanup", "message", "approve", "deny", "apply", "retain", "discard"] as const;
const AGENT_SCOPES = ["default", "builtin", "user", "project", "all"] as const;
const JOB_HISTORY_LIMIT = 50;

const AgentToolSchema = Type.Object({
  action: Type.Optional(StringEnum([...AGENT_ACTIONS], { description: "run a subagent, list agents/jobs, get a result, or control a Herdr child. Default: run when agent/task are provided, otherwise list." })),
  agent: Type.Optional(Type.String({ description: "Agent name to run, for example agent, search, oracle, librarian, reviewer, or painter." })),
  task: Type.Optional(Type.String({ description: "Self-contained task for the child agent." })),
  background: Type.Optional(Type.Boolean({ description: "Run without blocking and return a job id. Defaults to true unless the agent definition forbids background execution." })),
  jobId: Type.Optional(Type.String({ description: "Job id for result, control, messaging, permission, or worktree actions." })),
  message: Type.Optional(Type.String({ description: "Follow-up message for action=message." })),
  agentScope: Type.Optional(StringEnum([...AGENT_SCOPES], { description: "Agent definition scopes to search. default = built-in/package plus user agents. project/all require explicit opt-in and confirmation.", default: "default" })),
  includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden agents in list output. Default false." })),
  confirmProjectAgents: Type.Optional(Type.Boolean({ description: "Prompt before running project-local agents. Default true when UI is available." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the child agent. Defaults to the parent cwd." })),
}, { additionalProperties: false });

export type AgentToolParams = Static<typeof AgentToolSchema>;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export interface AgentToolDetails {
  action: AgentAction;
  agents?: Array<Pick<AgentDefinition, "name" | "description" | "source" | "hidden" | "model" | "thinking">>;
  jobs?: AgentJobSnapshot[];
  projectAgentsDir?: string | null;
}

const jobs = new Map<string, RuntimeJob>();

function textContent(text: string) { return { type: "text" as const, text }; }

export function getJobSnapshots(): AgentJobSnapshot[] {
  const merged = new Map<string, AgentJobSnapshot>();
  for (const stored of jobStore.list()) merged.set(stored.id, stored);
  for (const job of jobs.values()) {
    if (job.backend === "herdr") {
      const stored = jobStore.read(job.id);
      if (stored) merged.set(job.id, stored);
    } else {
      merged.set(job.id, snapshotJob(job));
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function getRunningJobCount(): number {
  return getJobSnapshots().filter((job) => job.status === "running" || job.status === "queued").length;
}

function cancelInProcess(job: RuntimeJob, reason: string): AgentJobSnapshot {
  if (!isTerminalStatus(job.status)) {
    job.status = "cancelled";
    job.error = reason;
    job.endedAt = new Date().toISOString();
    job.controller.abort(reason);
    jobStore.write(snapshotJob(job));
  }
  return snapshotJob(job);
}

export async function cancelJob(jobId: string, reason = "Cancelled by parent agent."): Promise<AgentJobSnapshot | undefined> {
  const active = jobs.get(jobId);
  if (active?.backend === "in-process") return cancelInProcess(active, reason);
  const stored = jobStore.read(jobId);
  if (stored?.backend === "herdr") {
    const result = await cancelHerdrJob(jobId, reason);
    if (active && result) Object.assign(active, result);
    return result;
  }
  return active ? snapshotJob(active) : stored;
}

function pruneJobs(): void {
  const inProcess = Array.from(jobs.values()).filter((job) => job.backend === "in-process").sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const job of inProcess.slice(0, Math.max(0, inProcess.length - JOB_HISTORY_LIMIT))) {
    if (isTerminalStatus(job.status)) jobs.delete(job.id);
  }
  jobStore.prune(JOB_HISTORY_LIMIT);
}

export async function abortRunningJobs(reason = "Session shutdown", includeDetachedHerdr = false): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const job of jobs.values()) {
    if (isTerminalStatus(job.status)) continue;
    if (job.backend === "herdr") {
      if (includeDetachedHerdr || !job.background) pending.push(cancelHerdrJob(job.id, reason).then((snapshot) => { if (snapshot) ensureTerminalNotification(jobStore, snapshot.id); }));
    } else {
      cancelInProcess(job, reason);
      if (job.promise) pending.push(Promise.race([job.promise, new Promise((resolve) => setTimeout(resolve, 5_000))]));
    }
  }
  if (includeDetachedHerdr) {
    for (const job of jobStore.list()) {
      if (job.backend === "herdr" && !isTerminalStatus(job.status) && !jobs.has(job.id)) pending.push(cancelHerdrJob(job.id, reason));
    }
  }
  await Promise.allSettled(pending);
}

async function reconcileHerdrJobs(jobId?: string): Promise<void> {
  const client = new HerdrClient();
  const candidates = jobStore.list().filter((job) => job.backend === "herdr" && !isTerminalStatus(job.status) && job.herdr && (!jobId || job.id === jobId));
  await Promise.all(candidates.map(async (job) => {
    if (await client.getAgent(job.herdr!.agentName)) return;
    jobStore.update(job.id, (current) => ({
      ...current,
      status: "failed",
      error: "Herdr child is no longer running and did not produce a terminal result.",
      endedAt: new Date().toISOString(),
    }));
  }));
}

export function formatJobSummary(job: AgentJobSnapshot): string {
  const backend = job.backend === "herdr" && job.herdr ? `herdr:${job.herdr.agentName}` : job.backend;
  const header = `[${job.id}] ${job.agent} ${job.status} (${backend})`;
  if (job.status === "completed") {
    const worktree = job.worktree ? `\nWorktree: ${job.worktree.path}${job.worktree.appliedAt ? " (applied)" : ""}` : "";
    return `${header}\n${job.result?.summary ?? "(no output)"}${worktree}`;
  }
  if (job.status === "failed" || job.status === "cancelled") return `${header}\n${job.error ?? job.result?.errorMessage ?? "stopped"}`;
  const location = job.herdr ? `\nHerdr tab ${job.herdr.tabId}, pane ${job.herdr.paneId}` : "";
  const activity = job.activity ? `\nProgress: ${job.activity.summary}` : "";
  const waiting = job.permissionRequests?.length ? `\nWaiting for permission: ${job.permissionRequests.map((request) => request.description).join("; ")}` : "";
  return `${header}\nTask: ${job.task}${location}${activity}${waiting}`;
}

function formatJobs(values: AgentJobSnapshot[]): string {
  if (!values.length) return "No subagent jobs.";
  return values.map((job) => {
    const elapsed = job.endedAt ? `${job.startedAt} → ${job.endedAt}` : `started ${job.startedAt}`;
    const herdr = job.herdr ? ` herdr=${job.herdr.agentName} tab=${job.herdr.tabId} pane=${job.herdr.paneId}` : "";
    return `- ${job.id} ${job.status} ${job.agent} (${job.source}, ${job.backend}) ${elapsed}${herdr}\n  ${job.task}`;
  }).join("\n");
}

function listAgents(discovery: AgentDiscoveryResult, includeHidden: boolean): AgentToolDetails {
  return {
    action: "list",
    agents: discovery.agents.filter((agent) => includeHidden || !agent.hidden).map(({ name, description, source, hidden, model, thinking }) => ({ name, description, source, hidden, model, thinking })),
    jobs: getJobSnapshots(),
    projectAgentsDir: discovery.projectAgentsDir,
  };
}

async function confirmProjectAgentIfNeeded(agent: AgentDefinition, params: AgentToolParams, discovery: AgentDiscoveryResult, ctx: ExtensionContext): Promise<boolean> {
  if (agent.source !== "project" || params.confirmProjectAgents === false || !ctx.hasUI) return true;
  return ctx.ui.confirm("Run project-local subagent?", `Agent: ${agent.name}\nSource: ${agent.filePath}\nProject agents are repo-controlled prompts. Only continue for repositories you trust.\nProject agents dir: ${discovery.projectAgentsDir ?? "(unknown)"}`);
}

function resolveAction(params: AgentToolParams): AgentAction {
  if (params.action) return params.action as AgentAction;
  return params.agent || params.task ? "run" : "list";
}

function makeJob(agent: AgentDefinition, task: string, cwd: string, background: boolean, backend: "in-process" | "herdr", owner: AgentJobSnapshot["owner"], parentToolCallId: string): RuntimeJob {
  const startedAt = new Date().toISOString();
  return {
    id: `agent-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    agent: agent.name, source: agent.source, task, cwd, status: "queued", background, backend, startedAt, attempt: 1,
    model: agent.model, thinking: agent.thinking, owner, parentToolCallId, controller: new AbortController(),
    activity: { kind: "starting", summary: "Queued for launch", updatedAt: startedAt },
  };
}

function emitJobUpdate(snapshot: AgentJobSnapshot, onUpdate: AgentToolUpdateCallback<AgentToolDetails> | undefined): void {
  onUpdate?.({ content: [textContent(formatJobSummary(snapshot))], details: { action: "run", jobs: [snapshot] } });
}

export function createAgentTool() {
  return {
    name: "Agent",
    label: "Agent",
    description: "Run Amp-style Pi subagents. Inside Herdr, each child is an observable interactive Pi terminal with persistent structured results; outside Herdr, an isolated in-process backend is used.",
    promptSnippet: "Run an isolated child Pi subagent (agent/search/oracle/librarian/reviewer/painter) for self-contained work",
    promptGuidelines: [
      "Use Agent when a task can be delegated to an isolated subagent and summarized back to the parent.",
      "Subagents run in the background by default. Pass background=false only when the next parent action strictly depends on the result.",
      "Do not ask subagents to spawn other agents unless a user explicitly requests a workflow that requires it.",
    ],
    parameters: AgentToolSchema,
    async execute(toolCallId: string, params: AgentToolParams, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<AgentToolDetails> | undefined, ctx: ExtensionContext) {
      const action = resolveAction(params);
      const scope = (params.agentScope ?? "default") as AgentScope;
      const includeHidden = params.includeHidden === true;
      const discovery = discoverAgents(ctx.cwd, scope);
      const updateStatus = () => { const running = getRunningJobCount(); ctx.ui.setStatus("subagents", running ? `agents:${running}` : undefined); };

      if (action === "list") {
        await reconcileHerdrJobs();
        updateStatus();
        const details = listAgents(discovery, includeHidden);
        return { content: [textContent(`Available agents:\n${formatAgentList(discovery.agents, includeHidden)}\n\nJobs:\n${formatJobs(details.jobs ?? [])}`)], details };
      }

      if (action === "cleanup") {
        const cleaned = await cleanupHerdrJobs();
        for (const jobId of cleaned.removed) jobs.delete(jobId);
        pruneJobs(); updateStatus();
        return { content: [textContent(`Cleaned Herdr subagents: closed ${cleaned.closed.length}, removed ${cleaned.removed.length}.`)], details: { action, jobs: [] } };
      }

      if (["result", "cancel", "focus", "close", "message", "approve", "deny", "apply", "retain", "discard"].includes(action)) {
        if (!params.jobId) return { content: [textContent(`jobId is required for action=${action}.`)], details: { action, jobs: [] } };
        let snapshot: AgentJobSnapshot | undefined;
        const existing = getJobSnapshots().find((job) => job.id === params.jobId);
        const mutating = action !== "result";
        if (mutating && existing?.owner?.sessionId && existing.owner.sessionId !== ctx.sessionManager.getSessionId()) {
          return { content: [textContent(`Job ${params.jobId} belongs to another Pi session and cannot be controlled here.`)], details: { action, jobs: [] }, isError: true };
        }
        if (action === "result") { await reconcileHerdrJobs(params.jobId); snapshot = getJobSnapshots().find((job) => job.id === params.jobId); }
        if (action === "cancel") { snapshot = await cancelJob(params.jobId); if (snapshot) ensureTerminalNotification(jobStore, snapshot.id); }
        if (action === "focus") snapshot = await focusHerdrJob(params.jobId);
        if (action === "close") snapshot = await closeHerdrJob(params.jobId);
        if (action === "message") {
          if (!params.message) return { content: [textContent("message is required for action=message.")], details: { action, jobs: [] } };
          if (!existing || !isTerminalStatus(existing.status)) return { content: [textContent(`Job ${params.jobId} must be terminal before it can be resumed.`)], details: { action, jobs: existing ? [existing] : [] }, isError: true };
          snapshot = await messageHerdrJob(params.jobId, params.message);
        }
        if (action === "approve" || action === "deny") {
          const current = jobStore.read(params.jobId);
          if (!current?.permissionRequests?.length || current.status !== "waiting") return { content: [textContent(`Job ${params.jobId} is not waiting for a permission decision.`)], details: { action, jobs: current ? [current] : [] }, isError: true };
          const requestId = current.permissionRequests[0].id;
          snapshot = jobStore.update(params.jobId, (value) => ({ ...value, permissionRequests: (value.permissionRequests ?? []).map((request) => request.id === requestId ? { ...request, decision: action === "approve" ? "allow" : "deny", decidedAt: new Date().toISOString() } : request) }));
        }
        if (action === "apply" || action === "retain" || action === "discard") {
          snapshot = jobStore.update(params.jobId, (current) => action === "apply" ? applyAgentWorktree(current) : action === "retain" ? retainAgentWorktree(current) : discardAgentWorktree(current));
        }
        updateStatus();
        if (!snapshot) return { content: [textContent(`No compatible subagent job found: ${params.jobId}`)], details: { action, jobs: [] } };
        return { content: [textContent(formatJobSummary(snapshot))], details: { action, jobs: [snapshot] } };
      }

      if (!params.agent || !params.task) return { content: [textContent("agent and task are required for action=run.")], details: { action, jobs: [] } };
      const agent = getAgentByName(discovery.agents, params.agent, true);
      if (!agent) return { content: [textContent(`Unknown agent: ${params.agent}\n\n${formatAgentList(discovery.agents, includeHidden)}`)], details: listAgents(discovery, includeHidden) };
      if (!(await confirmProjectAgentIfNeeded(agent, params, discovery, ctx))) return { content: [textContent("Canceled: project-local subagent was not approved.")], details: { action, jobs: [] } };
      const background = params.background ?? agent.background !== false;
      if (background && agent.background === false) return { content: [textContent(`Agent ${agent.name} does not allow background execution.`)], details: { action, jobs: [] } };

      if (process.env.HERDR_ENV === "1" && !shouldUseHerdr()) {
        return { content: [textContent("Herdr subagent launch is unavailable: HERDR_ENV=1 but HERDR_SOCKET_PATH or HERDR_WORKSPACE_ID is missing. Refusing invisible fallback.")], details: { action, jobs: [] }, isError: true };
      }
      const backend = shouldUseHerdr() ? "herdr" : "in-process";
      const owner = { sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile() ?? undefined };
      const job = makeJob(agent, params.task, params.cwd ? path.resolve(ctx.cwd, params.cwd) : ctx.cwd, background, backend, owner, toolCallId);
      jobs.set(job.id, job);
      const spec = createJobSpec(snapshotJob(job), agent);
      try {
        jobStore.initialize(spec, snapshotJob(job), composeAgentPrompt(agent));
        const worktree = createAgentWorktree(snapshotJob(job), agent, jobStore);
        if (worktree) {
          job.worktree = worktree;
          job.cwd = worktree.childCwd;
          jobStore.write(snapshotJob(job));
        }
      } catch (error) {
        jobs.delete(job.id);
        const message = `Failed to initialize persistent subagent job: ${error instanceof Error ? error.message : String(error)}`;
        const stored = jobStore.read(job.id);
        if (stored?.worktree) {
          try { jobStore.write(discardAgentWorktree({ ...stored, status: "failed", error: message, endedAt: new Date().toISOString() })); } catch { /* preserve original setup failure */ }
        }
        jobStore.remove(job.id);
        return { content: [textContent(message)], details: { action, jobs: [] }, isError: true };
      }

      if (backend === "herdr") {
        try { await launchHerdrJob(job, agent, ctx); }
        catch {
          const failed = jobStore.read(job.id) ?? snapshotJob(job);
          updateStatus();
          return { content: [textContent(formatJobSummary(failed))], details: { action, jobs: [failed] }, isError: true };
        }
        updateStatus();
        if (background) {
          const started = jobStore.read(job.id)!;
          return {
            content: [textContent(`Started background Herdr subagent ${started.herdr?.agentName} as job ${job.id} in tab ${started.herdr?.tabId}, pane ${started.herdr?.paneId}. Use Agent action=result with jobId=${job.id} to retrieve it.`)],
            details: { action, jobs: [started] },
          };
        }
        const parentAbort = () => job.controller.abort("Parent Agent tool call was aborted.");
        if (signal?.aborted) parentAbort(); else signal?.addEventListener("abort", parentAbort, { once: true });
        try {
          const final = await waitForHerdrJob(job.id, job.controller.signal, (snapshot) => emitJobUpdate(snapshot, onUpdate));
          Object.assign(job, final); pruneJobs(); updateStatus();
          return { content: [textContent(formatJobSummary(final))], details: { action, jobs: [final] } };
        } finally { signal?.removeEventListener("abort", parentAbort); }
      }

      updateStatus();
      const parentAbort = () => job.controller.abort("Parent Agent tool call was aborted.");
      if (!background && signal) { if (signal.aborted) parentAbort(); else signal.addEventListener("abort", parentAbort, { once: true }); }
      else if (background) job.warnings = [...(job.warnings ?? []), "Outside Herdr, the SDK fallback is process-local and cannot survive parent Pi exit."];
      const promise = runInProcessJob(job, agent, ctx, background ? undefined : (snapshot) => emitJobUpdate(snapshot, onUpdate))
        .catch((error) => {
          job.status = job.controller.signal.aborted ? "cancelled" : "failed";
          job.error = error instanceof Error ? error.message : String(error);
          job.endedAt = new Date().toISOString();
          return snapshotJob(job);
        })
        .finally(() => { signal?.removeEventListener("abort", parentAbort); if (!background) updateStatus(); pruneJobs(); });
      job.promise = promise;
      if (background) {
        void promise;
        return { content: [textContent(`Started background in-process subagent job ${job.id} (${agent.name}). Use Agent action=result with jobId=${job.id} to retrieve it.`)], details: { action, jobs: [snapshotJob(job)] } };
      }
      const final = await promise;
      return { content: [textContent(formatJobSummary(final))], details: { action, jobs: [final] } };
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
      if (!details?.jobs?.length && !details?.agents?.length) return new Text(result.content[0]?.text ?? "", 0, 0);
      if (details.action === "list") {
        let text = `${theme.fg("toolTitle", "Agents")} ${theme.fg("accent", String(details.agents?.length ?? 0))} ${theme.fg("muted", `jobs ${details.jobs?.length ?? 0}`)}`;
        if (expanded) text += `\n${result.content[0]?.text ?? ""}`;
        return new Text(text, 0, 0);
      }
      const job = details.jobs?.[0];
      if (!job) return new Text("Agent: no job", 0, 0);
      const icon = job.status === "completed" ? theme.fg("success", "✓") : job.status === "failed" ? theme.fg("error", "✗") : job.status === "cancelled" ? theme.fg("warning", "◼") : theme.fg("warning", "⏳");
      let text = `${icon} ${theme.fg("toolTitle", job.agent)} ${theme.fg("accent", job.status)} ${theme.fg("muted", `${job.id} ${job.backend}`)}`;
      if (job.herdr) text += theme.fg("dim", ` ${job.herdr.agentName} ${job.herdr.tabId}/${job.herdr.paneId}`);
      if (job.result?.usage?.turns) text += theme.fg("dim", ` ${job.result.usage.turns} turns`);
      if (job.result?.summary && (expanded || isTerminalStatus(job.status))) text += `\n${job.result.summary}`;
      else if (job.error) text += `\n${theme.fg("error", job.error)}`;
      return new Text(text, 0, 0);
    },
  };
}

export { AgentToolSchema };
export type { AgentJobResult, AgentJobSnapshot } from "./job-types.ts";
