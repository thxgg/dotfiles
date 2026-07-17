import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "./agents.ts";
import { getActiveToolNames, getDisallowedToolNames } from "./agents.ts";
import { HerdrClient, type HerdrAgentInfo } from "./herdr-client.ts";
import { jobStore, type JobStore } from "./job-store.ts";
import type { AgentJobSnapshot, AgentJobSpec, RuntimeJob } from "./job-types.ts";
import { isTerminalStatus } from "./job-types.ts";

const childBridgePath = fileURLToPath(new URL("./child-bridge.ts", import.meta.url));
const STARTUP_TIMEOUT_MS = 30_000;
const FOREGROUND_WATCHDOG_MS = 12 * 60 * 60 * 1000;
let launchQueue: Promise<void> = Promise.resolve();

function serializeChildStartup<T>(operation: () => Promise<T>): Promise<T> {
  const run = launchQueue.then(operation, operation);
  launchQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function shouldUseHerdr(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HERDR_ENV === "1" && Boolean(env.HERDR_SOCKET_PATH) && Boolean(env.HERDR_WORKSPACE_ID);
}

function slug(value: string, maxLength = 32): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLength).replace(/-+$/g, "") || "agent";
}

function tabTaskLabel(task: string, maxLength: number): string {
  const readable = task
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:please\s+)?(?:investigate|research|review|analyze|inspect|find|check|explore|look into)\s+/i, "")
    .replace(/^why\s+/i, "");
  if (readable.length <= maxLength) return readable || "task";
  const clipped = readable.slice(0, maxLength - 1);
  const wordBoundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, wordBoundary >= Math.floor(maxLength / 2) ? wordBoundary : undefined).trimEnd()}…`;
}

function activityLabel(agentName: string): string {
  const labels: Record<string, string> = {
    search: "Searching",
    librarian: "Researching",
    reviewer: "Reviewing",
    "frontend-reviewer": "Reviewing UI",
    oracle: "Analyzing",
    painter: "Creating",
    check: "Checking",
    agent: "Working",
  };
  const name = slug(agentName);
  return labels[name] ?? `Running ${name}`;
}

export function makeHerdrNames(agentName: string, task: string, jobId: string): { agentName: string; tabLabel: string } {
  const suffix = jobId.replace(/^agent-/, "");
  const name = slug(agentName);
  const prefix = `${activityLabel(agentName)}: `;
  return { agentName: `pi-${name}-${suffix}`, tabLabel: `${prefix}${tabTaskLabel(task, 40 - prefix.length)}` };
}

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  const isInstalledPiCli = currentScript?.includes(`${path.sep}@earendil-works${path.sep}pi-coding-agent${path.sep}`);
  if (currentScript && !isBunVirtualScript && isInstalledPiCli && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
  return { command: "pi", args };
}

export function buildChildPiArgs(input: {
  job: AgentJobSnapshot;
  agent: AgentDefinition;
  trusted: boolean;
  promptPath: string;
}): string[] {
  const { job, agent } = input;
  const args = ["--name", `${agent.name}:${job.id.replace(/^agent-/, "")}`];
  if (agent.model) args.push("--model", agent.model);
  if (agent.thinking) args.push("--thinking", agent.thinking);
  const tools = getActiveToolNames(agent, Boolean(agent.outputSchema));
  if (tools?.length) args.push("--tools", tools.join(","));
  const exclusions = getDisallowedToolNames(agent);
  if (exclusions.length) args.push("--exclude-tools", exclusions.join(","));
  args.push("-e", childBridgePath, "--append-system-prompt", input.promptPath);
  args.push(input.trusted ? "--approve" : "--no-approve");
  args.push(`Task: ${job.task}`);
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failStoredJob(store: JobStore, jobId: string, message: string): AgentJobSnapshot | undefined {
  return store.update(jobId, (current) => ({
    ...current,
    status: "failed",
    error: message,
    endedAt: new Date().toISOString(),
    result: current.result ?? {
      summary: message,
      filesRead: [], filesChanged: [], validation: [], artifacts: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      toolCalls: [],
      errorMessage: message,
    },
  }));
}

export async function launchHerdrJob(
  job: RuntimeJob,
  agent: AgentDefinition,
  ctx: ExtensionContext,
  client = new HerdrClient(),
  store = jobStore,
): Promise<AgentJobSnapshot> {
  const workspaceId = process.env.HERDR_WORKSPACE_ID;
  if (!workspaceId) throw new Error("Herdr backend selected but HERDR_WORKSPACE_ID is unavailable.");
  const paths = store.paths(job.id);
  const names = makeHerdrNames(agent.name, job.task, job.id);
  const invocation = getPiInvocation(buildChildPiArgs({ job, agent, trusted: ctx.isProjectTrusted(), promptPath: paths.prompt }));
  const argv = [invocation.command, ...invocation.args];

  try {
    return await serializeChildStartup(async () => {
      const launched = await client.launch({
        workspaceId,
        cwd: job.cwd,
        label: names.tabLabel,
        agentName: names.agentName,
        env: {
          PI_SUBAGENT_JOB_SPEC: paths.spec,
          ...(process.env.PI_CODING_AGENT_DIR ? { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR } : {}),
        },
        argv,
        signal: job.controller.signal,
      });
      const warnings = [...(job.warnings ?? []), ...launched.warnings];
      if (agent.compaction) warnings.push("Herdr children use Pi's global compaction settings; per-agent compaction overrides are not available through the Pi CLI.");
      let snapshot = store.update(job.id, (current) => ({
        ...current,
        herdr: launched.metadata,
        warnings: warnings.length ? warnings : undefined,
      }));
      if (!snapshot) throw new Error(`Persistent state disappeared for ${job.id}.`);

      // Pi/jiti startup can contend when two fresh processes initialize at the
      // same instant. Hold only the launch phase until the bridge confirms the
      // child is running; the actual delegated work still overlaps normally.
      const deadline = Date.now() + STARTUP_TIMEOUT_MS;
      while (snapshot.status === "queued" && Date.now() < deadline) {
        if (job.controller.signal.aborted) {
          await cancelHerdrJob(job.id, "Parent aborted during child startup.", client, store);
          throw new Error("Parent aborted during child startup.");
        }
        await sleep(100);
        snapshot = store.read(job.id);
        if (!snapshot) throw new Error(`Persistent state disappeared for ${job.id}.`);
      }
      if (snapshot.status === "queued") throw new Error("Child bridge did not report startup within 30 seconds.");
      Object.assign(job, snapshot);
      return snapshot;
    });
  } catch (error) {
    const message = `Failed to launch Herdr subagent: ${error instanceof Error ? error.message : String(error)}`;
    const existing = store.read(job.id);
    if (existing && isTerminalStatus(existing.status)) {
      Object.assign(job, existing);
      throw new Error(message);
    }
    const failed = failStoredJob(store, job.id, message);
    if (failed) Object.assign(job, failed);
    throw new Error(message);
  }
}

export async function waitForHerdrJob(
  jobId: string,
  signal: AbortSignal | undefined,
  onUpdate: ((snapshot: AgentJobSnapshot) => void) | undefined,
  client = new HerdrClient(),
  store = jobStore,
): Promise<AgentJobSnapshot> {
  const started = Date.now();
  let lastSerialized = "";
  let lastAgentCheck = 0;
  while (true) {
    if (signal?.aborted) {
      return (await cancelHerdrJob(jobId, "Parent Agent tool call was aborted.", client, store)) ?? (() => { throw new Error(`Subagent job disappeared: ${jobId}`); })();
    }
    const snapshot = store.read(jobId);
    if (!snapshot) throw new Error(`Persistent subagent state disappeared: ${jobId}`);
    const serialized = JSON.stringify(snapshot);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      onUpdate?.(snapshot);
    }
    if (isTerminalStatus(snapshot.status)) return snapshot;

    const elapsed = Date.now() - started;
    if (snapshot.status === "queued" && elapsed > STARTUP_TIMEOUT_MS) {
      return failStoredJob(store, jobId, "Child bridge did not report startup within 30 seconds.")!;
    }
    if (elapsed > FOREGROUND_WATCHDOG_MS) {
      return failStoredJob(store, jobId, "Foreground subagent exceeded the 12-hour orchestration watchdog.")!;
    }
    if (snapshot.herdr && Date.now() - lastAgentCheck >= 2_000) {
      lastAgentCheck = Date.now();
      try {
        const live = await client.getAgent(snapshot.herdr.agentName);
        if (!live) return failStoredJob(store, jobId, "Herdr child disappeared before producing a terminal result.")!;
      } catch (error) {
        return failStoredJob(store, jobId, `Herdr status check failed: ${error instanceof Error ? error.message : String(error)}`)!;
      }
    }
    await sleep(250);
  }
}

export async function cancelHerdrJob(jobId: string, reason: string, client = new HerdrClient(), store = jobStore): Promise<AgentJobSnapshot | undefined> {
  let snapshot = store.read(jobId);
  if (!snapshot || snapshot.backend !== "herdr" || isTerminalStatus(snapshot.status)) return snapshot;
  if (!snapshot.herdr) {
    return store.update(jobId, (current) => ({ ...current, status: "cancelled", error: reason, endedAt: new Date().toISOString() }));
  }

  let live: HerdrAgentInfo | undefined;
  let controlError: string | undefined;
  try {
    live = await client.getAgent(snapshot.herdr.agentName);
    if (live) await client.sendEscape(live.pane_id);
  } catch (error) {
    controlError = error instanceof Error ? error.message : String(error);
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    await sleep(100);
    snapshot = store.read(jobId);
    if (!snapshot || isTerminalStatus(snapshot.status)) return snapshot;
  }
  try { if (live) await client.closeTab(live.tab_id); } catch { /* retain cancellation state even if already closed */ }
  return store.update(jobId, (current) => ({
    ...current,
    status: "cancelled",
    error: live ? reason : controlError ? `${reason} Herdr control failed: ${controlError}` : `${reason} Herdr agent was no longer resolvable.`,
    endedAt: new Date().toISOString(),
  }));
}

export async function focusHerdrJob(jobId: string, client = new HerdrClient(), store = jobStore): Promise<AgentJobSnapshot | undefined> {
  const snapshot = store.read(jobId);
  if (!snapshot?.herdr) return snapshot;
  const live = await client.focus(snapshot.herdr.agentName);
  return store.update(jobId, (current) => ({
    ...current,
    herdr: { ...current.herdr!, workspaceId: live.workspace_id, tabId: live.tab_id, paneId: live.pane_id, terminalId: live.terminal_id },
  }));
}

export async function closeHerdrJob(jobId: string, client = new HerdrClient(), store = jobStore): Promise<AgentJobSnapshot | undefined> {
  const snapshot = store.read(jobId);
  if (!snapshot?.herdr) return snapshot;
  // Resolve the durable unique name first. Never act on a stale stored tab id,
  // which could refer to a different terminal after topology changes.
  const live = await client.getAgent(snapshot.herdr.agentName);
  if (live) await client.closeTab(live.tab_id);
  if (!isTerminalStatus(snapshot.status)) {
    return store.update(jobId, (current) => ({ ...current, status: "cancelled", error: live ? "Closed by parent agent." : "Child was already closed.", endedAt: new Date().toISOString() }));
  }
  return snapshot;
}

export async function cleanupHerdrJobs(client = new HerdrClient(), store = jobStore): Promise<{ closed: string[]; removed: string[] }> {
  const closed: string[] = [];
  const prunable = new Set<string>();
  for (const job of store.list()) {
    if (job.backend !== "herdr" || !isTerminalStatus(job.status) || !job.herdr || (job.worktree && !job.worktree.discardedAt)
      || !(job.notifications ?? []).every((notification) => notification.state === "delivered" || Boolean(notification.obsoleteAt))) continue;
    try {
      const live = await client.getAgent(job.herdr.agentName);
      if (live) { await client.closeTab(live.tab_id); closed.push(job.id); }
      prunable.add(job.id);
    } catch {
      // Keep the record when close fails so the unique control target is not lost.
    }
  }
  const removed: string[] = [];
  for (const jobId of prunable) {
    if (store.remove(jobId)) removed.push(jobId);
  }
  return { closed, removed };
}

export async function messageHerdrJob(jobId: string, message: string, client = new HerdrClient(), store = jobStore): Promise<AgentJobSnapshot | undefined> {
  const snapshot = store.read(jobId);
  if (!snapshot?.herdr) return snapshot;
  const live = await client.getAgent(snapshot.herdr.agentName);
  if (!live) throw new Error(`Herdr child is not available: ${snapshot.herdr.agentName}`);
  const resumed = store.update(jobId, (current) => ({
    ...current,
    status: "running",
    attempt: (current.attempt ?? 1) + 1,
    endedAt: undefined,
    error: undefined,
    permissionRequests: undefined,
    notifications: (current.notifications ?? []).map((item) => item.kind === "completion" && item.state !== "delivered" ? { ...item, obsoleteAt: new Date().toISOString() } : item),
    activity: { kind: "reasoning", summary: "Resuming with a follow-up message", updatedAt: new Date().toISOString() },
  }));
  try {
    await client.send(snapshot.herdr.agentName, message);
    return resumed;
  } catch (error) {
    store.update(jobId, (current) => current.attempt === resumed?.attempt ? snapshot : current);
    throw error;
  }
}

export function createJobSpec(job: AgentJobSnapshot, agent: AgentDefinition, store = jobStore): AgentJobSpec {
  const paths = store.paths(job.id);
  return { version: 2, jobId: job.id, stateDir: paths.dir, promptPath: paths.prompt, createdAt: job.startedAt, agent };
}
