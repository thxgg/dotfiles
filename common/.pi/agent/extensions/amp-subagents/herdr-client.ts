import { execFile } from "node:child_process";
import type { HerdrJobMetadata } from "./job-types.ts";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CommandExecutor {
  run(command: string, args: string[], options?: { cwd?: string; signal?: AbortSignal; timeout?: number }): Promise<CommandResult>;
}

export class ExecFileExecutor implements CommandExecutor {
  run(command: string, args: string[], options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {}): Promise<CommandResult> {
    return new Promise((resolve) => {
      execFile(command, args, {
        cwd: options.cwd,
        env: process.env,
        signal: options.signal,
        timeout: options.timeout ?? 30_000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      }, (error, stdout, stderr) => {
        const code = typeof (error as NodeJS.ErrnoException & { code?: number } | null)?.code === "number"
          ? (error as unknown as { code: number }).code
          : error ? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr) || (error instanceof Error ? error.message : ""), code });
      });
    });
  }
}

export interface HerdrAgentInfo {
  terminal_id: string;
  name?: string;
  agent?: string;
  agent_status: string;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
}

interface TabCreatedResult {
  type: "tab_created";
  tab: { tab_id: string; workspace_id: string };
  root_pane: { pane_id: string; tab_id: string; workspace_id: string; terminal_id: string };
}

interface AgentStartedResult {
  type: "agent_started";
  agent: HerdrAgentInfo;
  argv: string[];
}

function parseEnvelope(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Herdr returned an empty response.");
  let envelope: unknown;
  try { envelope = JSON.parse(trimmed); } catch { throw new Error(`Herdr returned invalid JSON: ${trimmed.slice(0, 500)}`); }
  if (!envelope || typeof envelope !== "object") throw new Error("Herdr returned an invalid response envelope.");
  const record = envelope as Record<string, unknown>;
  const error = record.error as Record<string, unknown> | undefined;
  if (error) throw new Error(`Herdr ${String(error.code ?? "error")}: ${String(error.message ?? "unknown error")}`);
  const result = record.result;
  if (!result || typeof result !== "object") throw new Error("Herdr response did not include a result.");
  return result as Record<string, unknown>;
}

export function parseTabCreated(stdout: string): TabCreatedResult {
  const result = parseEnvelope(stdout) as unknown as TabCreatedResult;
  if (result.type !== "tab_created" || !result.tab?.tab_id || !result.root_pane?.pane_id) {
    throw new Error("Unexpected Herdr tab create response.");
  }
  return result;
}

export function parseAgentStarted(stdout: string): AgentStartedResult {
  const result = parseEnvelope(stdout) as unknown as AgentStartedResult;
  if (result.type !== "agent_started" || !result.agent?.pane_id || !result.agent?.terminal_id) {
    throw new Error("Unexpected Herdr agent start response.");
  }
  return result;
}

export function parseAgentInfo(stdout: string): HerdrAgentInfo {
  const result = parseEnvelope(stdout) as unknown as { type: string; agent: HerdrAgentInfo };
  if (result.type !== "agent_info" || !result.agent?.pane_id || !result.agent?.terminal_id) {
    throw new Error("Unexpected Herdr agent get response.");
  }
  return result.agent;
}

export function buildTabCreateArgs(workspaceId: string, cwd: string, label: string): string[] {
  return ["tab", "create", "--workspace", workspaceId, "--cwd", cwd, "--label", label, "--no-focus"];
}

export function buildAgentStartArgs(input: {
  name: string;
  cwd: string;
  tabId: string;
  env: Record<string, string>;
  argv: string[];
}): string[] {
  const args = ["agent", "start", input.name, "--cwd", input.cwd, "--tab", input.tabId, "--no-focus"];
  for (const [key, value] of Object.entries(input.env).sort(([a], [b]) => a.localeCompare(b))) {
    args.push("--env", `${key}=${value}`);
  }
  args.push("--", ...input.argv);
  return args;
}

export class HerdrClient {
  private readonly executor: CommandExecutor;
  private readonly command: string;

  constructor(executor: CommandExecutor = new ExecFileExecutor(), command = process.env.HERDR_BIN_PATH || "herdr") {
    this.executor = executor;
    this.command = command;
  }

  private async exec(args: string[], options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {}): Promise<string> {
    const result = await this.executor.run(this.command, args, options);
    if (result.code !== 0) {
      let detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
      if (result.stdout.trim()) {
        try { parseEnvelope(result.stdout); } catch (error) {
          if (error instanceof Error && error.message.startsWith("Herdr ") && !error.message.startsWith("Herdr returned")) detail = error.message;
        }
      }
      throw new Error(`Herdr command failed (${args.slice(0, 3).join(" ")}): ${detail}`);
    }
    return result.stdout;
  }

  async launch(input: {
    workspaceId: string;
    cwd: string;
    label: string;
    agentName: string;
    env: Record<string, string>;
    argv: string[];
    signal?: AbortSignal;
  }): Promise<{ metadata: HerdrJobMetadata; warnings: string[] }> {
    const tab = parseTabCreated(await this.exec(buildTabCreateArgs(input.workspaceId, input.cwd, input.label), { cwd: input.cwd, signal: input.signal }));
    try {
      const started = parseAgentStarted(await this.exec(buildAgentStartArgs({
        name: input.agentName,
        cwd: input.cwd,
        tabId: tab.tab.tab_id,
        env: input.env,
        argv: input.argv,
      }), { cwd: input.cwd, signal: input.signal }));
      const metadata: HerdrJobMetadata = {
        agentName: input.agentName,
        workspaceId: started.agent.workspace_id,
        tabId: started.agent.tab_id,
        paneId: started.agent.pane_id,
        terminalId: started.agent.terminal_id,
      };
      const warnings: string[] = [];
      try {
        await this.exec(["pane", "close", tab.root_pane.pane_id]);
      } catch (error) {
        warnings.push(`Child launched, but temporary pane cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { metadata, warnings };
    } catch (error) {
      try { await this.exec(["tab", "close", tab.tab.tab_id]); } catch { /* preserve the launch error */ }
      throw error;
    }
  }

  async getAgent(name: string): Promise<HerdrAgentInfo | undefined> {
    try { return parseAgentInfo(await this.exec(["agent", "get", name], { timeout: 10_000 })); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/agent_not_found|target .* not found/i.test(message)) return undefined;
      throw error;
    }
  }

  async focus(name: string): Promise<HerdrAgentInfo> {
    return parseAgentInfo(await this.exec(["agent", "focus", name]));
  }

  async closeTab(tabId: string): Promise<void> {
    await this.exec(["tab", "close", tabId]);
  }

  async sendEscape(paneId: string): Promise<void> {
    await this.exec(["pane", "send-keys", paneId, "esc"]);
  }

  async requestCancel(name: string): Promise<HerdrAgentInfo | undefined> {
    const current = await this.getAgent(name);
    if (!current) return undefined;
    await this.sendEscape(current.pane_id);
    return current;
  }
}
