// Headless transport for the pi-subagent fork. One supervisor owns one RPC child.
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { inboxDir, processExists, readMetadata, updateMetadata } from "./shared.ts";

const runDir = process.argv[2];
const loaded = readMetadata(runDir);
if (!loaded) throw new Error("Missing subagent metadata");
const initial = loaded;
const cliPath = fileURLToPath(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
const client = new RpcClient({
  cliPath, cwd: initial.cwd, provider: initial.provider, model: initial.model,
  env: { PI_SUBAGENT_RUN_DIR: runDir },
  args: ["--session", initial.sessionFile, "--thinking", initial.thinking,
    ...(initial.launchArgs ?? []), "--extension", join(dirname(fileURLToPath(import.meta.url)), "child.ts"),
    "--exclude-tools", "Agent,subagent,workflow"],
});
let stopping = false;
let timer: ReturnType<typeof setInterval> | undefined;
let processing = false;
let sessionName = initial.name;
let saving: Promise<void> = Promise.resolve();
const toolTimers = new Map<string, ReturnType<typeof setTimeout>>();
let firstResponseTimer: ReturnType<typeof setTimeout> | undefined;

async function stop(suspended: boolean, error?: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (firstResponseTimer) clearTimeout(firstResponseTimer);
  for (const timeout of toolTimers.values()) clearTimeout(timeout);
  await client.stop();
  await saving;
  updateMetadata(runDir, { state: error ? "error" : "exited", suspended, error, pid: undefined });
}

client.onEvent((event) => {
  // RpcClient forwards extension UI records too. Headless children must not wait
  // indefinitely for a dialog that this transport cannot display.
  const record = event as unknown as Record<string, unknown>;
  if (record.type === "extension_ui_request" && ["confirm", "select", "input", "editor"].includes(String(record.method))) {
    void stop(false, "Child requested interactive input. Supply the missing input in a new prompt.");
    return;
  }
  if (event.type === "message_update" || ((event.type === "message_start" || event.type === "message_end") && event.message.role === "assistant")) {
    if (firstResponseTimer) clearTimeout(firstResponseTimer);
    firstResponseTimer = undefined;
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    writeFileSync(join(runDir, "progress.json"), JSON.stringify(event.message), { mode: 0o600 });
  }
  if (event.type === "tool_execution_start") toolTimers.set(event.toolCallId, setTimeout(() => { void stop(false, "Child tool exceeded three minutes."); }, 180_000));
  if (event.type === "tool_execution_end") { clearTimeout(toolTimers.get(event.toolCallId)); toolTimers.delete(event.toolCallId); }
  if (event.type === "agent_start") {
    updateMetadata(runDir, { state: "busy", hasStarted: true, completedAt: undefined, aborted: undefined, error: undefined });
    firstResponseTimer = setTimeout(() => { void stop(false, "Child produced no response within 45 seconds."); }, 45_000);
  }
  if (event.type === "agent_settled") {
    // Persist a receipt only at native settlement, never at agent_end (which can retry).
    saving = saving.then(async () => {
      const messages = await client.getMessages();
      writeFileSync(join(runDir, "messages.json"), JSON.stringify(messages), { mode: 0o600 });
      const state = await client.getState();
      updateMetadata(runDir, { state: state.isStreaming || state.pendingMessageCount ? "busy" : "idle", completedAt: new Date().toISOString(), aborted: event.aborted,
        childSessionId: state.sessionId, sessionFile: state.sessionFile ?? initial.sessionFile });
    }).catch((error: unknown) => { void stop(false, error instanceof Error ? error.message : String(error)); });
  }
});

async function tick(): Promise<void> {
  if (processing || stopping) return;
  processing = true;
  try {
    if (initial.parentPid && !processExists(initial.parentPid)) { void stop(true); return; }
    const current = readMetadata(runDir);
    if (current?.name !== sessionName) { sessionName = current?.name; await client.setSessionName(sessionName ?? initial.handle); }
    const queue = readdirSync(inboxDir(runDir)).filter((name) => name.endsWith(".json")).sort();
    // Cancellation has priority over prompts that have not been submitted yet.
    const control = queue.find((name) => {
      const value: unknown = JSON.parse(readFileSync(join(inboxDir(runDir), name), "utf8"));
      return value !== null && typeof value === "object" && "control" in value;
    });
    for (const name of control ? [control] : queue) {
      if (stopping) break;
      const path = join(inboxDir(runDir), name);
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!value || typeof value !== "object") throw new Error("Invalid inbox record");
      const record = value as Record<string, unknown>;
      if (record.control === "suspend" || record.control === "stop") {
        for (const queued of queue) unlinkSync(join(inboxDir(runDir), queued));
        void stop(record.control === "suspend");
        break;
      }
      if (typeof record.message !== "string" || !["auto", "followUp"].includes(String(record.delivery))) throw new Error("Invalid inbox message");
      await saving;
      updateMetadata(runDir, { state: "busy", completedAt: undefined, error: undefined });
      const structured = join(runDir, "structured.json");
      if (existsSync(structured)) unlinkSync(structured);
      const disposition = await client.prompt(record.message, undefined, record.delivery === "followUp" ? "followUp" : "steer");
      unlinkSync(path);
      if (disposition === "handled") throw new Error("Prompt was handled without starting a model run");
    }
    // Detect unexpected process exit even when it emitted no settlement event.
    if (!stopping) await client.getState();
  } catch (error) {
    void stop(false, error instanceof Error ? error.message : String(error));
  } finally { processing = false; }
}

process.on("SIGTERM", () => { void stop(true); });
process.on("SIGINT", () => { void stop(true); });
try {
  updateMetadata(runDir, { pid: process.pid, state: "starting", suspended: false });
  await client.start();
  const state = await client.getState();
  await client.setSessionName(initial.name ?? initial.handle);
  updateMetadata(runDir, { state: "idle", childSessionId: state.sessionId, sessionFile: state.sessionFile ?? initial.sessionFile });
  timer = setInterval(() => { void tick(); }, 250);
  await tick();
} catch (error) {
  await stop(false, error instanceof Error ? error.message : String(error));
}
