import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 24 * 1024;

export interface ActiveOperation {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  startedAt: number;
  latestOutput?: string;
}

export interface ActivitySnapshot {
  active: ActiveOperation[];
  recent: ActiveOperation[];
}

function truncate(text: string): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) return text;
  return `${bytes.subarray(0, MAX_OUTPUT_BYTES).toString("utf8").replace(/�+$/g, "")}\n[truncated]`;
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => Boolean(part) && typeof part === "object" && (part as { type?: string }).type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join("\n");
}

function operationView(operation: ActiveOperation): Record<string, unknown> {
  return {
    toolCallId: operation.toolCallId,
    toolName: operation.toolName,
    args: operation.args,
    startedAt: new Date(operation.startedAt).toISOString(),
    elapsedSeconds: Math.round((Date.now() - operation.startedAt) / 100) / 10,
    ...(operation.latestOutput ? { latestOutput: truncate(operation.latestOutput) } : {}),
  };
}

export function createActivityTool(getSnapshot: () => ActivitySnapshot): ToolDefinition {
  return {
    name: "get_main_thread_activity",
    label: "Main thread activity",
    description: "Inspect the parent Pi session's active and recently completed tool operations, including elapsed time and recent output. This never changes the parent session.",
    parameters: Type.Object({}),
    async execute() {
      const snapshot = getSnapshot();
      const value = {
        active: snapshot.active.map(operationView),
        recent: snapshot.recent.map(operationView),
      };
      return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: value };
    },
  };
}

const PROCESS_COLUMNS = "pid=,ppid=,stat=,etime=,%cpu=,%mem=,command=";

export function filterProcessRows(output: string, pid: number | undefined): string {
  if (!pid) return output.trim();
  return output
    .split("\n")
    .filter((line) => {
      const [rowPid, rowParentPid] = line.trim().split(/\s+/, 3);
      return Number(rowPid) === pid || Number(rowParentPid) === pid;
    })
    .join("\n")
    .trim();
}

export function parsePositivePid(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const pid = typeof value === "number" ? value : Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function createProcessTool(): ToolDefinition {
  return {
    name: "inspect_processes",
    label: "Inspect processes",
    description: "Read process state with ps. With no PID, list the current user's processes. With a PID, inspect that process and its direct children. This tool cannot signal or modify processes.",
    parameters: Type.Object({ pid: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async execute(_id, params, signal) {
      const pid = parsePositivePid((params as { pid?: number }).pid);
      // `ps -x` is portable across Linux and macOS and scopes the unfiltered
      // view to the current user's processes. Use `-ax` for a PID lookup so a
      // child remains visible even when it has no controlling terminal.
      const args = [pid ? "-ax" : "-x", "-o", PROCESS_COLUMNS];
      try {
        const { stdout, stderr } = await execFileAsync("ps", args, {
          signal,
          timeout: 5_000,
          maxBuffer: MAX_OUTPUT_BYTES * 2,
          encoding: "utf8",
        });
        const rows = filterProcessRows(stdout, pid);
        const output = truncate([rows, stderr.trim()].filter(Boolean).join("\n")) || "No matching processes.";
        return { content: [{ type: "text", text: output }], details: { pid } };
      } catch (error) {
        throw new Error(`Process inspection failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
