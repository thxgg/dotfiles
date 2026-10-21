import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { enqueue, getRunsDir, inboxDir, launchRun, readMetadata, stopRun, writeMetadata, type RunMetadata } from "./shared.ts";
import { isBoundedJsonSchema } from "./structured-output.ts";

export interface ChildResult {
  ok: boolean;
  output: string;
  messages: unknown[];
  structured?: unknown;
  error?: string;
  sessionFile?: string;
  sessionId?: string;
}
export interface ChildTask {
  prompt: string;
  cwd: string;
  provider: string;
  model: string;
  thinking: string;
  parentSessionId: string;
  parentSessionFile?: string;
  schema?: unknown;
  projectTrusted?: boolean;
  signal: AbortSignal;
  onProgress?(message: Record<string, unknown>): void;
}

/** Workflow adapter to the same persistent, headless runtime used by the CLI. */
export async function runChildTask(task: ChildTask): Promise<ChildResult> {
  let run: RunMetadata | undefined;
  let result: ChildResult = { ok: false, output: "", messages: [] };
  try {
    if (task.signal.aborted) return { ...result, error: "Workflow child was cancelled." };
    if (task.schema !== undefined && !isBoundedJsonSchema(task.schema)) return { ...result, error: "Invalid structured output schema." };
    const handle = randomBytes(8).toString("hex");
    const runDir = join(getRunsDir(), handle);
    mkdirSync(inboxDir(runDir), { recursive: true, mode: 0o700 });
    const now = new Date().toISOString();
    run = { version: 1, handle, runDir, cwd: task.cwd, sessionFile: join(runDir, "session.jsonl"),
      provider: task.provider, model: task.model, thinking: task.thinking, kind: "workflow", prompt: task.prompt,
      parentPid: process.pid, parentSessionId: task.parentSessionId, parentSessionFile: task.parentSessionFile,
      launchArgs: [task.projectTrusted ? "--approve" : "--no-approve"],
      state: "starting", hasStarted: false, createdAt: now, updatedAt: now };
    writeFileSync(run.sessionFile, "", { mode: 0o600 });
    if (task.schema !== undefined) writeFileSync(join(runDir, "schema.json"), JSON.stringify(task.schema), { mode: 0o600 });
    writeMetadata(run);
    enqueue(runDir, { message: task.prompt, delivery: "auto" });
    await launchRun(run);
    const deadline = Date.now() + 30 * 60 * 1000;
    let lastProgress = "";
    while (Date.now() < deadline) {
      if (task.signal.aborted) { result.error = "Workflow child was cancelled."; break; }
      const current = readMetadata(runDir);
      if (!current) { result.error = "Child metadata disappeared."; break; }
      run = current;
      const progressPath = join(runDir, "progress.json");
      if (task.onProgress && existsSync(progressPath)) {
        try {
          const raw = readFileSync(progressPath, "utf8");
          if (raw !== lastProgress) {
            const message: unknown = JSON.parse(raw);
            if (isRecord(message)) task.onProgress(message);
            lastProgress = raw;
          }
        } catch { /* Retry a partially written progress snapshot on the next tick. */ }
      }
      if (current.state === "error" || current.state === "exited") { result.error = current.error ?? "Child exited before settlement."; break; }
      const pending = readdirSync(inboxDir(runDir)).some((name) => name.endsWith(".json"));
      if (current.completedAt && current.state === "idle" && !pending) {
        const messages: unknown = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
        result.messages = Array.isArray(messages) ? messages : [];
        const last = result.messages.findLast((message) => isRecord(message) && message.role === "assistant");
        if (isRecord(last)) {
          result.output = messageText(last).slice(0, 64 * 1024);
          if (last.stopReason === "error" || last.stopReason === "aborted") result.error = typeof last.errorMessage === "string" ? last.errorMessage : `Child ${last.stopReason}.`;
          else result.ok = true;
        } else result.error = "Child finished without an assistant response.";
        const structuredPath = join(runDir, "structured.json");
        if (existsSync(structuredPath)) result.structured = JSON.parse(readFileSync(structuredPath, "utf8"));
        if (task.schema !== undefined && result.structured === undefined) { result.ok = false; result.error = "Child did not produce required structured output."; }
        if (current.aborted) { result.ok = false; result.error = "Child run was aborted."; }
        break;
      }
      if (Date.now() - Date.parse(current.createdAt) > 45_000 && !current.hasStarted) { result.error = "Child did not start within 45 seconds."; break; }
      await delay(100);
    }
    if (!result.ok && !result.error) result.error = "Child exceeded its 30-minute deadline.";
  } catch (error) {
    result = { ...result, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (run) {
      result.sessionFile = run.sessionFile;
      result.sessionId = run.childSessionId;
      try { await stopRun(readMetadata(run.runDir) ?? run); }
      catch (error) { result.ok = false; result.error = `Child cleanup failed: ${String(error)}`; }
    }
  }
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function messageText(message: Record<string, unknown>): string {
  if (typeof message.content === "string") return message.content;
  return Array.isArray(message.content) ? message.content.filter(isRecord).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n") : "";
}
