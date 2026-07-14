import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { jobStore, type JobStore } from "./job-store.ts";
import type { AgentJobSnapshot, AgentNotification } from "./job-types.ts";
import { isTerminalStatus } from "./job-types.ts";
import { HerdrClient } from "./herdr-client.ts";

const POLL_MS = 500;
const RESULT_LIMIT = 12 * 1024;
const CUSTOM_TYPE = "agent-notification";

export interface AgentNotificationDetails {
  notificationId: string;
  job: AgentJobSnapshot;
}

export function completionNotification(job: AgentJobSnapshot): AgentNotification {
  return {
    id: `completion-${job.attempt ?? 1}-${randomUUID()}`,
    kind: "completion",
    state: "pending",
    createdAt: new Date().toISOString(),
  };
}

export function permissionNotification(job: AgentJobSnapshot): AgentNotification {
  return {
    id: `permission-${job.permissionRequests?.[0]?.id ?? randomUUID()}`,
    kind: "permission",
    state: "pending",
    createdAt: new Date().toISOString(),
  };
}

function truncate(value: string, max = RESULT_LIMIT): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= max) return value;
  let output = value.slice(0, max);
  while (Buffer.byteLength(output, "utf8") > max) output = output.slice(0, -1);
  return `${output}\n\n[Result truncated; use Agent action=result jobId=${"JOB_ID"} for the full structured result.]`;
}

export function notificationContent(job: AgentJobSnapshot, notification: AgentNotification, activeSessionJobs?: number): string {
  if (notification.kind === "permission") {
    const requestId = notification.id.replace(/^permission-/, "");
    const request = job.permissionRequests?.find((item) => item.id === requestId);
    if (!request) return "";
    return [
      `Background agent ${job.agent} (${job.id}) needs a decision.`,
      `Tool: ${request.toolName}`,
      `Request: ${request.description}`,
      `Use Agent action=approve or action=deny with jobId=${job.id}.`,
    ].join("\n");
  }
  const status = job.status === "completed" ? "completed" : job.status === "cancelled" ? "was cancelled" : "failed";
  const summary = truncate(job.result?.summary ?? job.error ?? "(no output)").replace("JOB_ID", job.id);
  const usage = job.result?.usage;
  const worktree = job.worktree
    ? `\nIsolated changes: ${job.worktree.path}${job.worktree.appliedAt ? " (applied)" : ""}. Use Agent action=apply, retain, or discard with jobId=${job.id}.`
    : "";
  const synthesis = activeSessionJobs === 0
    ? "No background subagents remain active for this session. Deliver the complete updated final response now. Integrate all relevant findings and reproduce the full self-contained deliverable; do not merely acknowledge this result or refer to an earlier report."
    : activeSessionJobs === undefined
      ? ""
      : `${activeSessionJobs} background subagent(s) remain active for this session. Integrate this result, but wait to deliver the complete final response until all subagents relevant to the user's request are terminal.`;
  return [
    `Background agent ${job.agent} (${job.id}) ${status}.`,
    summary,
    usage ? `Usage: ${usage.turns} turns, ${usage.input + usage.cacheRead} input tokens, ${usage.output} output tokens, $${usage.cost.toFixed(4)}.` : "",
    worktree,
    `Full result: Agent action=result jobId=${job.id}.`,
    synthesis,
  ].filter(Boolean).join("\n\n");
}

function belongsToSession(job: AgentJobSnapshot, sessionId: string): boolean {
  return job.owner?.sessionId === sessionId;
}

function claimableNotifications(store: JobStore, sessionId: string): Array<{ job: AgentJobSnapshot; notification: AgentNotification }> {
  const now = Date.now();
  const values: Array<{ job: AgentJobSnapshot; notification: AgentNotification }> = [];
  for (const job of store.list()) {
    if (!belongsToSession(job, sessionId)) continue;
    for (const notification of job.notifications ?? []) {
      if (notification.state === "delivered" || notification.obsoleteAt) continue;
      if (notification.state === "delivering" && notification.leaseExpiresAt && Date.parse(notification.leaseExpiresAt) > now) continue;
      values.push({ job, notification });
    }
  }
  return values;
}

export function registerAgentNotificationRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<AgentNotificationDetails>(CUSTOM_TYPE, (message, _options, theme) => {
    const job = message.details?.job;
    if (!job) return new Text(typeof message.content === "string" ? message.content : "Agent notification", 0, 0);
    const icon = job.status === "completed" ? theme.fg("success", "✓") : job.status === "waiting" ? theme.fg("warning", "?") : theme.fg("error", "✗");
    return new Text(`${icon} ${theme.fg("toolTitle", job.agent)} ${theme.fg("muted", job.id)}\n${message.content}`, 0, 0);
  });
}

export function startNotificationPump(pi: ExtensionAPI, ctx: ExtensionContext, store: JobStore = jobStore, herdr = new HerdrClient()): () => void {
  const sessionId = ctx.sessionManager.getSessionId();
  const owner = `${sessionId}:${process.pid}:${randomUUID()}`;
  let stopped = false;
  let running = false;

  const pump = async () => {
    if (stopped || running) return;
    running = true;
    try {
      for (const job of store.list()) {
        if (!belongsToSession(job, sessionId) || job.backend !== "herdr" || isTerminalStatus(job.status) || !job.herdr) continue;
        try {
          if (await herdr.getAgent(job.herdr.agentName)) continue;
          const failed = store.update(job.id, (current) => ({ ...current, status: "failed", error: "Herdr child disappeared before producing a terminal result.", endedAt: new Date().toISOString() }));
          if (failed && failed.background && !failed.notifications?.some((item) => item.kind === "completion")) store.addNotification(failed.id, completionNotification(failed));
        } catch { /* transient Herdr failures must not falsely kill jobs */ }
      }
      for (const candidate of claimableNotifications(store, sessionId)) {
        const claimed = store.claimNotification(candidate.job.id, candidate.notification.id, owner);
        const notification = claimed?.notifications?.find((item) => item.id === candidate.notification.id);
        if (!claimed || notification?.state !== "delivering" || notification.leaseOwner !== owner) continue;
        try {
          const activeSessionJobs = notification.kind === "completion"
            ? store.list().filter((job) => belongsToSession(job, sessionId) && ["queued", "running", "waiting"].includes(job.status)).length
            : undefined;
          const content = notificationContent(claimed, notification, activeSessionJobs);
          if (!content) {
            store.completeNotification(claimed.id, notification.id, owner);
            continue;
          }
          pi.sendMessage<AgentNotificationDetails>({
            customType: CUSTOM_TYPE,
            content,
            display: true,
            details: { notificationId: notification.id, job: claimed },
          }, { deliverAs: notification.kind === "permission" ? "steer" : "followUp", triggerTurn: true });
          store.completeNotification(claimed.id, notification.id, owner);
        } catch {
          store.releaseNotification(claimed.id, notification.id, owner);
        }
      }
      const active = store.list().filter((job) => belongsToSession(job, sessionId) && ["queued", "running", "waiting"].includes(job.status)).length;
      ctx.ui.setStatus("subagents", active ? `agents:${active}` : undefined);
    } finally { running = false; }
  };

  const timer = setInterval(() => { void pump(); }, POLL_MS);
  timer.unref?.();
  void pump();
  return () => { stopped = true; clearInterval(timer); };
}

export function ensureTerminalNotification(store: JobStore, jobId: string): AgentJobSnapshot | undefined {
  const current = store.read(jobId);
  if (!current || !current.background || !isTerminalStatus(current.status) || !current.owner) return current;
  if ((current.notifications ?? []).some((item) => item.kind === "completion" && item.id.startsWith(`completion-${current.attempt ?? 1}-`))) return current;
  return store.addNotification(jobId, completionNotification(current));
}
