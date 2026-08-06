import * as path from "node:path";
import { ExecFileExecutor, type CommandExecutor } from "./herdr-client.ts";

interface AgentListItem {
  pane_id?: string;
  agent_session?: { kind?: string; value?: string };
}

function resultEnvelope(stdout: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(stdout.trim()); } catch { throw new Error("Herdr returned invalid JSON while opening a child session."); }
  if (!value || typeof value !== "object") throw new Error("Herdr returned an invalid response while opening a child session.");
  const envelope = value as Record<string, unknown>;
  if (envelope.error && typeof envelope.error === "object") {
    const error = envelope.error as Record<string, unknown>;
    throw new Error(`Herdr ${String(error.code ?? "error")}: ${String(error.message ?? "unknown error")}`);
  }
  if (!envelope.result || typeof envelope.result !== "object") throw new Error("Herdr response did not include a result.");
  return envelope.result as Record<string, unknown>;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }

async function run(executor: CommandExecutor, command: string, args: string[], cwd?: string, timeout = 30_000): Promise<string> {
  const result = await executor.run(command, args, { cwd, timeout });
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Herdr command failed: ${args.join(" ")}`);
  return result.stdout;
}

export async function openSessionPane(input: {
  sessionFile: string;
  cwd: string;
  label: string;
  env?: NodeJS.ProcessEnv;
  executor?: CommandExecutor;
  command?: string;
}): Promise<{ paneId: string; reused: boolean }> {
  const env = input.env ?? process.env;
  if (env.HERDR_ENV !== "1" || !env.HERDR_PANE_ID) throw new Error("Opening a child session in a new pane requires a Herdr-managed parent pane.");
  const executor = input.executor ?? new ExecFileExecutor();
  const command = input.command ?? env.HERDR_BIN_PATH ?? "herdr";
  const target = path.resolve(input.sessionFile);

  const listed = resultEnvelope(await run(executor, command, ["agent", "list"], input.cwd, 10_000));
  const agents = Array.isArray(listed.agents) ? listed.agents as AgentListItem[] : [];
  const existing = agents.find((agent) => agent.pane_id && agent.agent_session?.kind === "path" && typeof agent.agent_session.value === "string" && path.resolve(agent.agent_session.value) === target);
  if (existing?.pane_id) {
    await run(executor, command, ["agent", "focus", existing.pane_id], input.cwd, 10_000);
    return { paneId: existing.pane_id, reused: true };
  }

  const split = resultEnvelope(await run(executor, command, ["pane", "split", env.HERDR_PANE_ID, "--direction", "right", "--cwd", input.cwd, "--no-focus"], input.cwd));
  const pane = split.pane as Record<string, unknown> | undefined;
  const paneId = typeof pane?.pane_id === "string" ? pane.pane_id : undefined;
  if (!paneId) throw new Error("Herdr did not return the new pane id.");
  try {
    const cleanupScript = `pi --session ${shellQuote(target)} --approve; status=$?; herdr pane close ${shellQuote(paneId)} >/dev/null 2>&1 || true; exit $status`;
    const launchCommand = `sh -lc ${shellQuote(cleanupScript)}`;
    await run(executor, command, ["pane", "run", paneId, launchCommand], input.cwd, 10_000);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const current = resultEnvelope(await run(executor, command, ["pane", "get", paneId], input.cwd, 10_000));
      const info = current.pane as AgentListItem | undefined;
      if (info?.agent_session?.kind === "path" && typeof info.agent_session.value === "string" && path.resolve(info.agent_session.value) === target) {
        await run(executor, command, ["agent", "focus", paneId], input.cwd, 10_000);
        return { paneId, reused: false };
      }
    }
    throw new Error("Timed out waiting for Pi to open the child session.");
  } catch (error) {
    try { await run(executor, command, ["pane", "close", paneId], input.cwd, 10_000); } catch { /* preserve the open failure */ }
    throw error;
  }
}
