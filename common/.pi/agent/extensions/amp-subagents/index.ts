import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents, formatAgentList, type AgentScope } from "./agents.ts";
import { registerRepoCacheTool } from "./repo-cache.ts";
import { abortRunningJobs, cancelJob, createAgentTool, getJobSnapshots, getRunningJobCount } from "./runtime.ts";

function parseAgentsCommand(args: string): { action: "list" | "jobs" | "result" | "cancel"; id?: string; scope: AgentScope; includeHidden: boolean } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const action = (parts[0] ?? "list").toLowerCase();
  const scopeArg = parts.find((part) => part.startsWith("scope="))?.slice("scope=".length) as AgentScope | undefined;
  const includeHidden = parts.includes("--hidden") || parts.includes("hidden");
  const scope = scopeArg && ["default", "builtin", "user", "project", "all"].includes(scopeArg) ? scopeArg : "default";

  if (action === "jobs") return { action: "jobs", scope, includeHidden };
  if (action === "result") return { action: "result", id: parts[1], scope, includeHidden };
  if (action === "cancel") return { action: "cancel", id: parts[1], scope, includeHidden };
  return { action: "list", scope, includeHidden };
}

function formatJobDetails(id?: string): string {
  const jobs = getJobSnapshots();
  const selected = id ? jobs.filter((job) => job.id === id) : jobs;
  if (selected.length === 0) return id ? `No subagent job found: ${id}` : "No subagent jobs.";
  return selected
    .map((job) => {
      const lines = [`${job.id} ${job.status} ${job.agent} (${job.source})`, `Task: ${job.task}`];
      if (job.result?.summary) lines.push(`Summary:\n${job.result.summary}`);
      if (job.error) lines.push(`Error: ${job.error}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

export default function ampSubagentsExtension(pi: ExtensionAPI): void {
  registerRepoCacheTool(pi);
  pi.registerTool(createAgentTool());

  pi.registerCommand("agents", {
    description: "List Amp-style subagents and inspect/cancel subagent jobs",
    getArgumentCompletions: (prefix: string) => {
      const options = ["list", "jobs", "result", "cancel", "list --hidden", "list scope=all"];
      const normalized = prefix.trim().toLowerCase();
      const filtered = options
        .filter((option) => option.startsWith(normalized))
        .map((option) => ({ value: option, label: option }));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
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
        const job = cancelJob(parsed.id, `Cancelled via /agents cancel ${parsed.id}`);
        if (!job) {
          ctx.ui.notify(`No subagent job found: ${parsed.id}`, "warning");
          return;
        }
        const running = getRunningJobCount();
        ctx.ui.setStatus("subagents", running > 0 ? `agents:${running}` : undefined);
        ctx.ui.notify(formatJobDetails(parsed.id), "info");
        return;
      }

      const discovery = discoverAgents(ctx.cwd, parsed.scope);
      const jobs = formatJobDetails();
      ctx.ui.notify(`Available agents:\n${formatAgentList(discovery.agents, parsed.includeHidden)}\n\nJobs:\n${jobs}`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const running = getRunningJobCount();
    ctx.ui.setStatus("subagents", running > 0 ? `agents:${running}` : undefined);
  });

  pi.on("session_shutdown", async () => {
    abortRunningJobs();
  });
}
