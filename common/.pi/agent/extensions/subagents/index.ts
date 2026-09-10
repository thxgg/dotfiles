import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents, formatAgentList, type AgentScope } from "./agents.ts";
import { registerRepoCacheTool } from "./repo-cache.ts";
import { abortRunningJobs, cancelJob, createAgentTool, getJobSnapshots, getRunningJobCount } from "./runtime.ts";
import { jobStore } from "./job-store.ts";
import { applyAgentWorktree, discardAgentWorktree, retainAgentWorktree } from "./worktree.ts";
import { registerAgentNotificationRenderer, startNotificationPump } from "./notifications.ts";
import { showSubagentDashboard } from "./dashboard.ts";
import { openSessionPane } from "./session-pane.ts";

function parseAgentsCommand(args: string): { action: "list" | "jobs" | "result" | "cancel" | "open" | "cleanup"; id?: string; scope: AgentScope; includeHidden: boolean } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const action = (parts[0] ?? "list").toLowerCase();
  const scopeArg = parts.find((part) => part.startsWith("scope="))?.slice("scope=".length) as AgentScope | undefined;
  const includeHidden = parts.includes("--hidden") || parts.includes("hidden");
  const scope = scopeArg && ["default", "builtin", "user", "project", "all"].includes(scopeArg) ? scopeArg : "default";

  if (action === "jobs") return { action: "jobs", scope, includeHidden };
  if (action === "result") return { action: "result", id: parts[1], scope, includeHidden };
  if (action === "cancel") return { action: "cancel", id: parts[1], scope, includeHidden };
  if (action === "open") return { action: "open", id: parts[1], scope, includeHidden };
  if (action === "cleanup") return { action: "cleanup", scope, includeHidden };
  return { action: "list", scope, includeHidden };
}

function decidePermission(jobId: string, decision: "allow" | "deny"): void {
  const current = jobStore.read(jobId);
  const request = current?.permissionRequests?.[0];
  if (!current || current.status !== "waiting" || !request) throw new Error(`${jobId} is not waiting for permission.`);
  jobStore.update(jobId, (value) => ({ ...value, permissionRequests: (value.permissionRequests ?? []).map((item) => item.id === request.id ? { ...item, decision, decidedAt: new Date().toISOString() } : item) }));
}

function mutateWorktree(jobId: string, action: (job: Parameters<typeof applyAgentWorktree>[0]) => ReturnType<typeof applyAgentWorktree>): void {
  const updated = jobStore.update(jobId, action);
  if (!updated) throw new Error(`Unknown subagent job: ${jobId}`);
}

function formatJobDetails(id?: string): string {
  const jobs = getJobSnapshots();
  const selected = id ? jobs.filter((job) => job.id === id) : jobs;
  if (selected.length === 0) return id ? `No subagent job found: ${id}` : "No subagent jobs.";
  return selected
    .map((job) => {
      const lines = [`${job.id} ${job.status} ${job.agent} (${job.source}, ${job.backend})`, `Task: ${job.task}`];
      if (job.sessionFile) lines.push(`Session: ${job.sessionFile}`, `Open: /agents open ${job.id}`);
      if (job.result?.summary) lines.push(`Summary:\n${job.result.summary}`);
      if (job.error) lines.push(`Error: ${job.error}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  registerRepoCacheTool(pi);
  registerAgentNotificationRenderer(pi);
  pi.registerTool(createAgentTool());
  let stopNotificationPump: (() => void) | undefined;

  pi.registerCommand("agents", {
    description: "List Pi subagents and inspect or control subagent jobs",
    getArgumentCompletions: (prefix: string) => {
      const options = ["list", "jobs", "result", "cancel", "open", "cleanup", "list --hidden", "list scope=all"];
      const normalized = prefix.trim().toLowerCase();
      const filtered = options
        .filter((option) => option.startsWith(normalized))
        .map((option) => ({ value: option, label: option }));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      if (!args.trim() && ctx.mode === "tui") {
        await showSubagentDashboard(ctx, getJobSnapshots, {
          async open(jobId) {
            const job = getJobSnapshots().find((value) => value.id === jobId);
            if (!job?.sessionFile) throw new Error(`Session for ${jobId} is not available yet.`);
            await openSessionPane({ sessionFile: job.sessionFile, cwd: job.cwd, label: job.id });
          },
          async cancel(jobId) { if (!(await cancelJob(jobId))) throw new Error(`Cannot cancel ${jobId}.`); },
          async approve(jobId) { decidePermission(jobId, "allow"); },
          async deny(jobId) { decidePermission(jobId, "deny"); },
          async apply(jobId) { mutateWorktree(jobId, applyAgentWorktree); },
          async retain(jobId) { mutateWorktree(jobId, retainAgentWorktree); },
          async discard(jobId) { mutateWorktree(jobId, discardAgentWorktree); },
        });
        return;
      }
      const parsed = parseAgentsCommand(args);
      if (parsed.action === "jobs") {
        ctx.ui.notify(formatJobDetails(), "info");
        return;
      }
      if (parsed.action === "result") {
        ctx.ui.notify(formatJobDetails(parsed.id), "info");
        return;
      }
      if (parsed.action === "cancel") {
        if (!parsed.id) {
          ctx.ui.notify("Usage: /agents cancel <jobId>", "warning");
          return;
        }
        const job = await cancelJob(parsed.id, `Cancelled via /agents cancel ${parsed.id}`);
        if (!job) {
          ctx.ui.notify(`No subagent job found: ${parsed.id}`, "warning");
          return;
        }
        const running = getRunningJobCount();
        ctx.ui.setStatus("subagents", running > 0 ? `agents:${running}` : undefined);
        ctx.ui.notify(formatJobDetails(parsed.id), "info");
        return;
      }
      if (parsed.action === "cleanup") {
        const removed = jobStore.prune();
        ctx.ui.notify(`Cleaned ${removed.length} terminal subagent job(s).`, "info");
        return;
      }
      if (parsed.action === "open") {
        if (!parsed.id) {
          ctx.ui.notify("Usage: /agents open <jobId>", "warning");
          return;
        }
        const job = getJobSnapshots().find((value) => value.id === parsed.id);
        if (!job?.sessionFile) {
          ctx.ui.notify(`Session for ${parsed.id} is not available yet.`, "warning");
          return;
        }
        await openSessionPane({ sessionFile: job.sessionFile, cwd: job.cwd, label: job.id });
        return;
      }

      const discovery = discoverAgents(ctx.cwd, parsed.scope);
      const jobs = formatJobDetails();
      ctx.ui.notify(`Available agents:\n${formatAgentList(discovery.agents, parsed.includeHidden)}\n\nJobs:\n${jobs}`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    stopNotificationPump?.();
    stopNotificationPump = startNotificationPump(pi, ctx);
    const running = getRunningJobCount();
    ctx.ui.setStatus("subagents", running > 0 ? `agents:${running}` : undefined);
  });

  pi.on("session_shutdown", async (event, ctx) => {
    stopNotificationPump?.();
    stopNotificationPump = undefined;
    if (event.reason !== "quit") return;
    const running = getJobSnapshots().filter((job) => job.status === "running" || job.status === "queued" || job.status === "waiting");
    if (!running.length) return;
    if (ctx.hasUI) await ctx.ui.notify(`${running.length} active subagent session(s) will stop because the parent Pi process is exiting. Their session transcripts remain saved.`, "warning");
    await abortRunningJobs("Parent Pi exited; child execution stopped. The persistent session remains available for inspection.");
  });
}
