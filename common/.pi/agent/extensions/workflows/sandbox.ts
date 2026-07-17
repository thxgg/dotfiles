import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { safeStringify, toSerializable } from "./serialization.ts";

const MAX_SOURCE = 512 * 1024;
const MAX_ARGS = 256 * 1024;
const MAX_MESSAGE = 512 * 1024;
const MAX_RESULT = 1024 * 1024;

export interface SandboxAgentResult { ok: boolean; output: string; structured?: unknown; error?: string; }
export interface SandboxAgentOptions { label?: unknown; phase?: unknown; agentType?: unknown; schema?: unknown; model?: unknown; effort?: unknown; }

function bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 1000);
  timer.unref?.();
}

export function runWorkflowSandbox(options: {
  source: string;
  args: unknown;
  cwd: string;
  signal: AbortSignal;
  onPhase(title: string): void;
  onAgent(prompt: string, agentOptions: SandboxAgentOptions, signal: AbortSignal): Promise<SandboxAgentResult>;
}): Promise<unknown> {
  if (!process.allowedNodeEnvironmentFlags.has("--permission")) return Promise.reject(new Error("This Node runtime cannot enforce workflow sandbox permissions."));
  if (bytes(options.source) > MAX_SOURCE) return Promise.reject(new Error("Workflow source exceeds 512 KB."));
  const argsJson = safeStringify({ defined: options.args !== undefined, value: options.args }, MAX_ARGS);
  return new Promise((resolve, reject) => {
    const childPath = fileURLToPath(new URL("./sandbox-child.cjs", import.meta.url));
    const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${path.dirname(childPath)}`, "--max-old-space-size=128", childPath], {
      cwd: options.cwd, env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const token = randomBytes(24).toString("hex");
    const active = new Map<number, AbortController>();
    const requestIds = new Set<number>();
    let settled = false;
    let requestCount = 0;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", onAbort);
      for (const controller of active.values()) controller.abort(new Error("Workflow stopped."));
      active.clear();
      terminate(child);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => finish(options.signal.reason instanceof Error ? options.signal.reason : new Error("Workflow aborted."));
    options.signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => { if (!settled) finish(new Error(`Workflow sandbox exited early (${signal ?? code ?? "unknown"}).`)); });
    child.on("message", (raw: unknown) => {
      if (!record(raw) || raw.token !== token || typeof raw.kind !== "string") return finish(new Error("Workflow sandbox sent invalid IPC."));
      if (raw.kind === "phase") {
        try { const payload = JSON.parse(String(raw.payloadJson)); if (!record(payload)) throw new Error(); options.onPhase(String(payload.title).slice(0, 160)); }
        catch { finish(new Error("Workflow sandbox sent an invalid phase.")); }
        return;
      }
      if (raw.kind === "agent") {
        if (typeof raw.payloadJson !== "string" || bytes(raw.payloadJson) > MAX_MESSAGE) return finish(new Error("Workflow agent request exceeded IPC limits."));
        let payload: unknown;
        try { payload = JSON.parse(raw.payloadJson); } catch { return finish(new Error("Workflow agent request was malformed.")); }
        if (!record(payload) || !Number.isInteger(payload.id) || typeof payload.id !== "number" || requestIds.has(payload.id) || typeof payload.prompt !== "string" || !record(payload.options)) return finish(new Error("Workflow agent request was invalid."));
        requestCount += 1;
        if (requestCount > 32) return finish(new Error("Workflow sandbox exceeded 32 agent requests."));
        requestIds.add(payload.id);
        const controller = new AbortController();
        active.set(payload.id, controller);
        void options.onAgent(payload.prompt, payload.options as SandboxAgentOptions, controller.signal).then((result) => {
          active.delete(payload.id as number);
          if (!child.connected || settled) return;
          let resultJson = safeStringify(result, MAX_MESSAGE);
          if (bytes(resultJson) > MAX_MESSAGE) resultJson = JSON.stringify({ ok: false, output: "", error: "Agent result exceeded IPC limit." });
          child.send({ token, kind: "agentResult", id: payload.id, resultJson });
        }).catch((error) => {
          active.delete(payload.id as number);
          if (child.connected && !settled) child.send({ token, kind: "agentResult", id: payload.id, resultJson: JSON.stringify({ ok: false, output: "", error: error instanceof Error ? error.message : String(error) }) });
        });
        return;
      }
      if (raw.kind === "result") {
        if (typeof raw.resultJson !== "string" || bytes(raw.resultJson) > MAX_RESULT) return finish(new Error("Workflow result exceeded 1 MB."));
        try { finish(undefined, toSerializable(JSON.parse(raw.resultJson))); } catch { finish(new Error("Workflow result was invalid JSON.")); }
        return;
      }
      if (raw.kind === "error" && typeof raw.error === "string") return finish(new Error(raw.error.slice(0, 16 * 1024)));
      finish(new Error("Workflow sandbox sent unknown IPC."));
    });
    child.send({ kind: "init", token, source: options.source, argsJson }, (error) => { if (error) finish(error); });
  });
}
