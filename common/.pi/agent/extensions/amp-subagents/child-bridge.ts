import { spawn } from "node:child_process";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPermissionGuard } from "./readonly.ts";
import { JobStore } from "./job-store.ts";
import type { AgentActivity, AgentJobResult, AgentJobSnapshot, ToolCallSummary, UsageStats } from "./job-types.ts";
import { emptyUsage, isTerminalStatus } from "./job-types.ts";
import { ensureTerminalNotification } from "./notifications.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getMessageText(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n");
}

function addUsage(usage: UsageStats, message: any): void {
  const value = message?.usage;
  if (!value) return;
  usage.input += Number(value.input ?? 0);
  usage.output += Number(value.output ?? 0);
  usage.cacheRead += Number(value.cacheRead ?? 0);
  usage.cacheWrite += Number(value.cacheWrite ?? 0);
  usage.cost += Number(value.cost?.total ?? value.cost ?? 0);
  usage.contextTokens = Number(value.totalTokens ?? value.contextTokens ?? usage.contextTokens);
  usage.turns += 1;
}

function collectPaths(name: string, args: Record<string, unknown>, filesRead: Set<string>, filesChanged: Set<string>): void {
  const value = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
  if (!value) return;
  if (name === "edit" || name === "write") filesChanged.add(value);
  if (["read", "grep", "find", "ls"].includes(name)) filesRead.add(value);
}

function collectArtifacts(result: unknown, artifacts: Set<string>): void {
  const images = asRecord(asRecord(result).details).images;
  if (!Array.isArray(images)) return;
  for (const image of images) {
    const imagePath = asRecord(image).path;
    if (typeof imagePath === "string") artifacts.add(imagePath);
  }
}

function isValidationCommand(command: string): boolean {
  return /\b(test|tests|check|lint|typecheck|tsc|pytest|vitest|jest|cargo\s+test|go\s+test|npm\s+test|pnpm\s+test|bun\s+test)\b/i.test(command);
}

export function closeCompletedHerdrTab(tabId: string, spawnProcess = spawn): void {
  if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_SOCKET_PATH) return;
  const command = process.env.HERDR_BIN_PATH || "herdr";
  const child = spawnProcess(command, ["tab", "close", tabId], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.on("error", () => { /* the persisted result remains available if UI cleanup fails */ });
  child.unref();
}

export default function childBridge(pi: ExtensionAPI): void {
  const specPath = process.env.PI_SUBAGENT_JOB_SPEC;
  if (!specPath) return;

  const store = new JobStore(path.dirname(path.dirname(path.resolve(specPath))));
  let spec;
  try {
    spec = store.readSpecFile(specPath);
  } catch (error) {
    // The parent watchdog reports a bridge startup failure when the spec cannot
    // be trusted enough to identify a job safely.
    console.error(`Subagent bridge could not load its job spec: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const initial = store.read(spec.jobId);
  if (!initial) {
    console.error(`Subagent bridge could not read state for ${spec.jobId}.`);
    return;
  }

  createPermissionGuard(spec.agent, { jobId: spec.jobId, store })(pi);

  const usage = initial.result?.usage ? { ...initial.result.usage } : emptyUsage();
  const toolCalls = new Map((initial.result?.toolCalls ?? []).map((call) => [call.id, { ...call }]));
  const filesRead = new Set(initial.result?.filesRead ?? []);
  const filesChanged = new Set(initial.result?.filesChanged ?? []);
  const validation = new Set(initial.result?.validation ?? []);
  const artifacts = new Set(initial.result?.artifacts ?? []);
  let finalSummary = initial.result?.summary ?? "";
  let stopReason = initial.result?.stopReason;
  let errorMessage = initial.result?.errorMessage;
  let maxTurnAbort = false;
  let settled = isTerminalStatus(initial.status);

  const activity = (kind: AgentActivity["kind"], summary: string, toolName?: string): AgentActivity => ({ kind, summary, toolName, updatedAt: new Date().toISOString() });
  const describeActivity = (name: string, args: Record<string, unknown>): string => {
    const target = String(args.path ?? args.file_path ?? "");
    if (name === "read") return `Reading ${target || "a file"}`;
    if (name === "edit" || name === "write") return `${name === "edit" ? "Editing" : "Writing"} ${target || "a file"}`;
    if (name === "bash") return `Running ${String(args.command ?? "a command").replace(/\s+/g, " ").slice(0, 96)}`;
    if (name === "grep" || name === "find") return `Searching ${target || "the codebase"}`;
    return `Using ${name}`;
  };

  const result = (): AgentJobResult => ({
    summary: finalSummary || "(no output)",
    filesRead: Array.from(filesRead).sort(),
    filesChanged: Array.from(filesChanged).sort(),
    validation: Array.from(validation),
    artifacts: Array.from(artifacts).sort(),
    usage: { ...usage },
    toolCalls: Array.from(toolCalls.values()),
    stopReason,
    errorMessage,
  });

  const safeUpdate = (updater: (current: AgentJobSnapshot) => AgentJobSnapshot): void => {
    try { store.update(spec.jobId, updater); }
    catch (error) { console.error(`Subagent bridge state update failed: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const writeProgress = (nextActivity?: AgentActivity): void => {
    if (settled) return;
    safeUpdate((current) => ({ ...current, status: current.status === "waiting" ? "waiting" : "running", result: result(), activity: nextActivity ?? current.activity }));
  };

  pi.on("session_start", (_event, ctx) => {
    if (settled) return;
    let sessionFile: string | undefined;
    let sessionId: string | undefined;
    try { sessionFile = ctx.sessionManager.getSessionFile() ?? undefined; } catch { /* optional */ }
    try { sessionId = ctx.sessionManager.getSessionId(); } catch { /* optional */ }
    safeUpdate((current) => ({ ...current, sessionFile, sessionId }));
  });

  pi.on("agent_start", () => {
    if (settled) {
      settled = false;
      stopReason = undefined;
      errorMessage = undefined;
      maxTurnAbort = false;
      safeUpdate((current) => ({ ...current, status: "running", endedAt: undefined, error: undefined, permissionRequests: undefined }));
    }
    writeProgress(activity("reasoning", "Starting delegated task"));
  });

  pi.on("tool_execution_start", (event: any) => {
    if (settled) return;
    const args = asRecord(event.args);
    const call: ToolCallSummary = {
      id: String(event.toolCallId ?? `${event.toolName}-${toolCalls.size + 1}`),
      name: String(event.toolName ?? "unknown"),
      args,
      status: "running",
    };
    toolCalls.set(call.id, call);
    collectPaths(call.name, args, filesRead, filesChanged);
    if (call.name === "bash" && typeof args.command === "string" && isValidationCommand(args.command)) validation.add(args.command);
    writeProgress(activity("tool", describeActivity(call.name, args), call.name));
  });

  pi.on("tool_execution_end", (event: any) => {
    if (settled) return;
    const call = toolCalls.get(String(event.toolCallId ?? ""));
    if (call) {
      call.status = event.isError ? "failed" : "completed";
      if (event.isError) call.error = getMessageText(event.result) || "tool failed";
    }
    collectArtifacts(event.result, artifacts);
    writeProgress(activity("reasoning", "Reasoning after tool result"));
  });

  pi.on("message_end", (event: any) => {
    if (settled || event.message?.role !== "assistant") return;
    const text = getMessageText(event.message).trim();
    if (text) finalSummary = text;
    addUsage(usage, event.message);
    if (event.message.stopReason) stopReason = event.message.stopReason;
    if (event.message.errorMessage) errorMessage = event.message.errorMessage;
    writeProgress();
  });

  pi.on("turn_end", (event: any, ctx) => {
    if (settled || !spec.agent.maxTurns) return;
    if (Number(event.turnIndex ?? 0) + 1 >= spec.agent.maxTurns) {
      maxTurnAbort = true;
      errorMessage = `Subagent ${spec.agent.name} stopped after reaching maxTurns=${spec.agent.maxTurns}.`;
      ctx.abort();
      writeProgress(activity("finishing", "Stopping at the configured turn limit"));
    }
  });

  pi.on("agent_settled", () => {
    if (settled) return;
    settled = true;
    const now = new Date().toISOString();
    const cancelled = maxTurnAbort || stopReason === "aborted";
    const failed = !cancelled && (Boolean(errorMessage) || stopReason === "error");
    const terminal = store.update(spec.jobId, (current) => ({
      ...current,
      status: cancelled ? "cancelled" : failed ? "failed" : "completed",
      error: cancelled || failed ? (errorMessage || (cancelled ? "Subagent was cancelled." : `Subagent stopped with reason: ${stopReason}`)) : undefined,
      endedAt: now,
      activity: activity("finishing", cancelled ? "Cancelled" : failed ? "Failed" : "Completed"),
      result: { ...result(), summary: finalSummary || errorMessage || "(no output)" },
    }));
    ensureTerminalNotification(store, spec.jobId);
    if (terminal?.herdr?.tabId) closeCompletedHerdrTab(terminal.herdr.tabId);
  });

  pi.on("session_shutdown", (event: any) => {
    if (settled || event?.reason !== "quit") return;
    settled = true;
    const message = "Child Pi exited before the delegated job settled.";
    safeUpdate((current) => ({
      ...current,
      status: "failed",
      error: message,
      endedAt: new Date().toISOString(),
      activity: activity("finishing", "Child exited unexpectedly"),
      result: { ...result(), summary: finalSummary || message, errorMessage: errorMessage || message },
    }));
    ensureTerminalNotification(store, spec.jobId);
  });
}
