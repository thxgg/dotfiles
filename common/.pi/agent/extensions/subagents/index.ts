import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRepoCacheTool } from "./repo-cache.ts";
import { assistantText, effectiveRunState, launchRun, listRuns, readLatestAssistant, runDisplayName, stopRun, updateMetadata } from "./shared.ts";

const packageDir = dirname(fileURLToPath(import.meta.url));

export default function subagentExtension(pi: ExtensionAPI): void {
  registerRepoCacheTool(pi);
  // Children get normal Pi resources, but cannot register another delegation stack.
  if (process.env.PI_SUBAGENT_RUN_DIR) return;
  pi.on("resources_discover", () => ({ skillPaths: [join(packageDir, "skills")] }));
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  const stopRefresh = () => {
    generation++;
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  pi.registerCommand("subagent", {
    description: "Inspect prompt-driven subagent sessions (no terminal multiplexer)",
    handler: async (args, ctx) => {
      const runs = listRuns(ctx.sessionManager.getSessionId());
      const selected = args.trim() || await ctx.ui.select("Subagents", runs.map((run) => `${run.handle} ${run.name ?? ""} [${effectiveRunState(run)}]`));
      const run = runs.find((run) => run.handle === selected?.split(" ")[0]);
      if (!run) { ctx.ui.notify("No subagent selected.", "info"); return; }
      const response = readLatestAssistant(run.sessionFile);
      // Read-only inspection. Never open a second writer on a running child's session.
      pi.sendMessage({ customType: "subagent-inspection", display: true,
        content: `${runDisplayName(run)}: ${effectiveRunState(run)}\nSession: ${run.sessionFile}\n${response ? assistantText(response).slice(0, 24000) : run.error ?? "No response yet."}` });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    stopRefresh();
    const currentGeneration = generation;
    const sessionId = ctx.sessionManager.getSessionId();
    process.env.PI_SUBAGENT_PARENT_PID = String(process.pid);
    const binDir = join(packageDir, "../../bin");
    if (!(process.env.PATH ?? "").split(delimiter).includes(binDir)) process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;
    for (const run of listRuns(ctx.sessionManager.getSessionId())) {
      if (run.suspended && run.kind !== "workflow" && existsSync(run.sessionFile)) {
        updateMetadata(run.runDir, { parentPid: process.pid, state: "starting", error: undefined });
        try { await launchRun({ ...run, parentPid: process.pid }); }
        catch (error) { ctx.ui.notify(`Cannot resume ${run.handle}: ${String(error)}`, "error"); }
      }
    }
    const refresh = () => {
      if (currentGeneration !== generation) return;
      const runs = listRuns(sessionId).filter((run) => run.kind !== "workflow");
      ctx.ui.setStatus("subagents", runs.length ? runs.map((run) => `${run.name ?? run.handle}:${effectiveRunState(run)}`).slice(-5).join(" | ") : undefined);
      for (const run of runs) {
        const receipt = effectiveRunState(run) === "error" ? `error:${run.updatedAt}` : run.completedAt;
        if (!receipt || !["idle", "error", "exited"].includes(effectiveRunState(run))) continue;
        const acknowledgement = join(run.runDir, "notified.txt");
        if (existsSync(acknowledgement) && readFileSync(acknowledgement, "utf8") === receipt) continue;
        const response = readLatestAssistant(run.sessionFile);
        pi.sendMessage({ customType: "subagent-result", display: true,
          content: `Subagent ${runDisplayName(run)} ${effectiveRunState(run)}.\nSession: ${run.sessionFile}\n${run.error ?? (response ? assistantText(response).slice(0, 24000) : "No assistant response.")}` },
          { triggerTurn: true, deliverAs: "followUp" });
        writeFileSync(acknowledgement, receipt, { mode: 0o600 });
      }
    };
    if (currentGeneration !== generation) return;
    // Timers run outside Pi's event error boundary. A stale context or a failed
    // state read must never bring down the parent RPC process.
    const safeRefresh = () => {
      try { refresh(); }
      catch (error) {
        stopRefresh();
        console.error(`Subagent status refresh stopped: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    safeRefresh();
    if (currentGeneration !== generation) return;
    timer = setInterval(safeRefresh, 1000);
    timer.unref();
  });
  pi.on("session_shutdown", async (event, ctx) => {
    stopRefresh();
    ctx.ui.setStatus("subagents", undefined);
    if (event.reason === "reload") return;
    await Promise.all(listRuns(ctx.sessionManager.getSessionId()).map(async (run) => {
      try { await stopRun(run, run.kind !== "workflow"); }
      catch (error) { ctx.ui.notify(String(error), "warning"); }
    }));
  });
}
