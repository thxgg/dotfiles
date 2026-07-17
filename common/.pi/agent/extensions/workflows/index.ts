import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { WorkflowController } from "./controller.ts";
import { showWorkflowDashboard } from "./dashboard.ts";
import { showActivityDashboard } from "./activity.ts";
import { prepareWorkflowScript } from "./meta.ts";
import { emptyUsage, formatElapsed, shortenHome, type WorkflowAgentRecord, type WorkflowDetails } from "./model.ts";
import { runWorkflowAgent } from "./runner.ts";
import { runWorkflowSandbox, type SandboxAgentResult } from "./sandbox.ts";
import { listWorkflows, loadWorkflow, persistWorkflow, runDir } from "./store.ts";

const ACTIONS = ["run", "list", "result", "cancel", "restart", "save"] as const;
const Params = Type.Object({
  action: Type.Optional(StringEnum([...ACTIONS], { description: "Run, inspect, control, restart, or save a workflow. Defaults to run when script is provided, otherwise list." })),
  script: Type.Optional(Type.String({ description: "JavaScript workflow using phase(), agent(), parallel(), args, and a final return." })),
  args: Type.Optional(Type.String({ description: "Optional JSON arguments; raw string when not valid JSON." })),
  background: Type.Optional(Type.Boolean({ description: "Return immediately and notify the parent when complete. Default true." })),
  runId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String({ description: "Reusable workflow name for action=save." })),
});

function parseArgs(value: string | undefined): unknown { if (value === undefined) return undefined; try { return JSON.parse(value); } catch { return value; } }
function summary(details: WorkflowDetails): string {
  const ok = details.agents.filter((agent) => agent.state === "done").length;
  const failed = details.agents.filter((agent) => agent.state === "error").length;
  return `Workflow ${details.name ?? details.runId} ${details.status}: ${ok}/${details.agents.length} agents ok${failed ? `, ${failed} failed` : ""} in ${formatElapsed(details.startedAt, details.finishedAt)}.${details.currentPhase ? ` Last phase: ${details.currentPhase}.` : ""}${details.error ? ` Error: ${details.error}` : ""}\nArtifacts: ${shortenHome(runDir(details.runId))}`;
}
function savedDir(): string { return path.join(getAgentDir(), "workflows"); }
function safeName(value: string): string { const name = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 64); if (!name) throw new Error("Workflow name must contain letters or numbers."); return name; }

export default function workflowsExtension(pi: ExtensionAPI): void {
  const active = new Map<string, { details: WorkflowDetails; controller: WorkflowController; source: string; args: unknown }>();
  let lastUi: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]["ui"] | undefined;
  const updateStatus = () => { lastUi?.setStatus("workflows", active.size ? `workflows:${active.size}` : undefined); };
  pi.on("session_start", (_event, ctx) => { lastUi = ctx.ui; updateStatus(); });
  pi.on("session_shutdown", async () => { for (const run of active.values()) run.controller.abort("Parent session is shutting down."); await Promise.all([...active.values()].map((run) => run.controller.settle(true))); lastUi?.setStatus("workflows", undefined); });

  const approveWorkflow = async (source: string, ctx: any): Promise<void> => {
    if (!ctx.hasUI) return;
    const prepared = prepareWorkflowScript(source);
    const phases = prepared.meta.phases.map((phase) => `• ${phase.title}${phase.detail ? ` — ${phase.detail}` : ""}`).join("\n") || "• Dynamic phases declared at runtime";
    const approved = await ctx.ui.confirm("Run generated workflow?", `${prepared.meta.name ?? "Unnamed workflow"}\n\n${prepared.meta.description ?? ""}\n\n${phases}\n\nThe orchestration script runs sandboxed and may spawn up to 32 agent calls.`);
    if (!approved) throw new Error("Workflow was not approved.");
  };
  const run = async (input: { runId?: string; source: string; args: unknown; background: boolean; ctx: any; signal?: AbortSignal; onUpdate?: (details: WorkflowDetails) => void }): Promise<WorkflowDetails> => {
    const prepared = prepareWorkflowScript(input.source);
    const runId = input.runId ?? `wf_${randomBytes(6).toString("hex")}`;
    const details: WorkflowDetails = { runId, sessionId: input.ctx.sessionManager.getSessionId(), name: prepared.meta.name, description: prepared.meta.description, background: input.background, status: "running", startedAt: Date.now(), phases: prepared.meta.phases, agents: [], sourcePath: path.join(runDir(runId), "script.js") };
    const controller = new WorkflowController(input.background ? undefined : input.signal);
    active.set(runId, { details, controller, source: input.source, args: input.args });
    persistWorkflow(details, input.source, input.args); updateStatus();
    let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
    const checkpoint = () => { if (checkpointTimer) return; checkpointTimer = setTimeout(() => { checkpointTimer = undefined; persistWorkflow(details); input.onUpdate?.(details); }, 150); checkpointTimer.unref?.(); };
    let index = 0;
    try {
      details.result = await runWorkflowSandbox({
        source: prepared.source, args: input.args, cwd: input.ctx.cwd, signal: controller.signal,
        onPhase(title) { details.currentPhase = title; if (!details.phases.some((phase) => phase.title === title)) details.phases.push({ title }); checkpoint(); },
        async onAgent(prompt, options, invocationSignal): Promise<SandboxAgentResult> {
          const record: WorkflowAgentRecord = { index: ++index, label: typeof options.label === "string" ? options.label.slice(0, 160) : `agent-${index}`, phase: typeof options.phase === "string" ? options.phase.slice(0, 160) : details.currentPhase, state: "queued", startedAt: Date.now(), preview: "Queued", usage: emptyUsage(), transcript: [] };
          details.agents.push(record); checkpoint();
          return controller.schedule(async (signal) => {
            record.state = "running"; record.preview = "Starting"; checkpoint();
            const outcome = await runWorkflowAgent({ prompt, agentType: options.agentType, schema: options.schema, model: options.model, effort: options.effort, cwd: input.ctx.cwd, projectTrusted: input.ctx.isProjectTrusted(), ctx: input.ctx, signal, onProgress(progress) { Object.assign(record, { preview: progress.output?.slice(0, 300) ?? record.preview, usage: progress.usage ?? record.usage, model: progress.model ?? record.model, transcript: progress.transcript ?? record.transcript }); checkpoint(); } });
            record.finishedAt = Date.now(); record.state = outcome.ok ? "done" : outcome.error === "Workflow child was cancelled." ? "cancelled" : "error"; record.preview = outcome.output || outcome.error || "No output"; record.error = outcome.error; record.usage = outcome.usage; record.model = outcome.model; record.transcript = outcome.transcript; checkpoint();
            return { ok: outcome.ok, output: outcome.output, structured: outcome.structured, error: outcome.error };
          }, invocationSignal).catch((error) => { record.state = "error"; record.error = error instanceof Error ? error.message : String(error); record.finishedAt = Date.now(); checkpoint(); return { ok: false, output: "", error: record.error }; });
        },
      });
      details.status = "completed";
    } catch (error) { details.status = controller.signal.aborted ? "cancelled" : "failed"; details.error = error instanceof Error ? error.message : String(error); controller.abort(details.error); }
    const settled = await controller.settle(details.status !== "completed");
    if (!settled) { details.status = "failed"; details.error = `${details.error ? `${details.error}; ` : ""}children did not settle before shutdown timeout`; }
    details.finishedAt = Date.now(); if (checkpointTimer) clearTimeout(checkpointTimer); persistWorkflow(details); active.delete(runId); updateStatus(); return details;
  };

  const restartRun = async (runId: string, ctx: any): Promise<WorkflowDetails> => {
    const previous = loadWorkflow(runId);
    if (!previous) throw new Error(`Unknown workflow: ${runId}`);
    const source = fs.readFileSync(previous.sourcePath, "utf8");
    let args: unknown;
    try { args = JSON.parse(fs.readFileSync(path.join(runDir(runId), "args.json"), "utf8")); } catch { /* optional */ }
    await approveWorkflow(source, ctx);
    return run({ source, args, background: true, ctx });
  };
  const saveRun = (runId: string, name?: string): string => {
    const details = loadWorkflow(runId);
    if (!details) throw new Error(`Unknown workflow: ${runId}`);
    const targetName = safeName(name ?? details.name ?? details.runId);
    fs.mkdirSync(savedDir(), { recursive: true });
    fs.copyFileSync(details.sourcePath, path.join(savedDir(), `${targetName}.js`));
    return targetName;
  };
  pi.registerCommand("activity", { description: "Open the unified activity dashboard", handler: async (_args, ctx) => showActivityDashboard(ctx) });
  pi.registerCommand("workflows", { description: "Open the workflow run dashboard", handler: async (_args, ctx) => showWorkflowDashboard(ctx, () => new Map([...active].map(([id, value]) => [id, value.details])), {
    async cancel(runId) { const current = active.get(runId); if (!current) throw new Error(`${runId} is not active.`); current.controller.abort("Cancelled from /workflows."); },
    async restart(runId) { void restartRun(runId, ctx); },
    async save(runId) { saveRun(runId); },
  }) });
  pi.registerCommand("workflow-run", { description: "Run a saved workflow by name", getArgumentCompletions(prefix) { try { return fs.readdirSync(savedDir()).filter((file) => file.endsWith(".js") && file.startsWith(prefix)).map((file) => ({ value: file.slice(0, -3), label: file.slice(0, -3) })); } catch { return null; } }, handler: async (args, ctx) => { const [name, ...rest] = args.trim().split(/\s+/); if (!name) return ctx.ui.notify("Usage: /workflow-run <name> [args]", "warning"); const source = fs.readFileSync(path.join(savedDir(), `${safeName(name)}.js`), "utf8"); await approveWorkflow(source, ctx); const result = await run({ source, args: parseArgs(rest.join(" ") || undefined), background: true, ctx }); ctx.ui.notify(summary(result), result.status === "completed" ? "info" : "error"); } });

  pi.registerTool({
    name: "workflow", label: "Workflow",
    description: "Run an approved, sandboxed JavaScript workflow for multi-agent, multi-phase work. Use only when the user explicitly requests a workflow or the task clearly requires structured fan-out, cross-checking, and synthesis. Scripts use phase(), agent(), parallel(), args, and return a JSON-serializable aggregate. Ordinary isolated units belong in Agent instead.",
    promptSnippet: "Orchestrate bounded multi-agent workflows with phases, parallel children, structured outputs, and persisted progress",
    promptGuidelines: ["Use workflow for task-level orchestration; use Agent for one isolated unit of work or specialized capability.", "Workflow scripts must check every agent() result's ok field before consuming output or structured data.", "Do not emulate agent teams or peer messaging; pass results explicitly through workflow variables."],
    parameters: Params,
    async execute(_id, params, signal, onUpdate, ctx) {
      const action = params.action ?? (params.script ? "run" : "list");
      if (action === "list") { const runs = listWorkflows(); return { content: [{ type: "text", text: runs.length ? runs.map(summary).join("\n\n") : "No workflow runs." }], details: { action, runs } }; }
      if (!params.runId && ["result", "cancel", "restart", "save"].includes(action)) return { content: [{ type: "text", text: `runId is required for action=${action}.` }], details: { action, runs: [] } };
      if (action === "result") { const details = loadWorkflow(params.runId!); return { content: [{ type: "text", text: details ? `${summary(details)}\n\nResult:\n${JSON.stringify(details.result, null, 2)}` : `Unknown workflow: ${params.runId}` }], details: { action, runs: details ? [details] : [] } }; }
      if (action === "cancel") { const current = active.get(params.runId!); if (current) current.controller.abort("Cancelled by parent."); const details = current?.details ?? loadWorkflow(params.runId!); return { content: [{ type: "text", text: details ? `Cancellation requested for ${params.runId}.` : `Unknown workflow: ${params.runId}` }], details: { action, runs: details ? [details] : [] } }; }
      if (action === "save") { const details = loadWorkflow(params.runId!); if (!details) return { content: [{ type: "text", text: `Unknown workflow: ${params.runId}` }], details: { action, runs: [] } }; const name = saveRun(params.runId!, params.name); return { content: [{ type: "text", text: `Saved workflow as /workflow-run ${name}.` }], details: { action, runs: [details] } }; }
      if (action === "restart") { const previous = loadWorkflow(params.runId!); if (!previous) return { content: [{ type: "text", text: `Unknown workflow: ${params.runId}` }], details: { action, runs: [] } }; const completion = restartRun(params.runId!, ctx); if (params.background ?? true) { void completion.then((details) => { try { pi.sendMessage({ customType: "workflow-notification", content: summary(details), display: true, details }, { deliverAs: "followUp", triggerTurn: true }); } catch { /* persisted result remains available */ } }).catch(() => undefined); return { content: [{ type: "text", text: `Restarted workflow ${params.runId} in background.` }], details: { action, runs: [] } }; } const details = await completion; return { content: [{ type: "text", text: summary(details) }], details: { action, runs: [details] } }; }
      if (!params.script) return { content: [{ type: "text", text: "script is required for action=run." }], details: { action, runs: [] } };
      await approveWorkflow(params.script, ctx);
      const background = params.background ?? true;
      const newRunId = `wf_${randomBytes(6).toString("hex")}`;
      const completion = run({ runId: newRunId, source: params.script, args: parseArgs(params.args), background, ctx, signal, onUpdate: (details) => onUpdate?.({ content: [{ type: "text", text: summary(details) }], details: { action, runs: [details] } }) });
      if (background) {
        void completion.then((details) => {
          try { pi.sendMessage({ customType: "workflow-notification", content: `${summary(details)}\n\nIntegrate the workflow result into the user's task.`, display: true, details }, { deliverAs: "followUp", triggerTurn: true }); }
          catch { /* parent session may have shut down; persisted result remains available */ }
        }).catch(() => undefined);
        return { content: [{ type: "text", text: `Workflow ${newRunId} launched in background. Open /workflows to monitor it; a completion message will arrive when it settles.` }], details: { action, runs: [] } };
      }
      const details = await completion; if (details.status !== "completed") throw new Error(summary(details)); return { content: [{ type: "text", text: `${summary(details)}\n\nResult:\n${JSON.stringify(details.result, null, 2)}` }], details: { action, runs: [details] } };
    },
    renderCall(args, theme) { const meta = args.script ? prepareWorkflowScript(args.script).meta : undefined; return new Text(`${theme.fg("toolTitle", theme.bold("Workflow "))}${theme.fg("accent", args.action ?? "run")}${meta?.name ? theme.fg("muted", ` ${meta.name}`) : ""}`, 0, 0); },
    renderResult(result, _options, theme) { const run = (result.details as any)?.runs?.[0] as WorkflowDetails | undefined; return new Text(run ? `${theme.fg(run.status === "completed" ? "success" : run.status === "running" ? "warning" : "error", "■")} ${theme.fg("accent", run.name ?? run.runId)} ${theme.fg("dim", summary(run))}` : (result.content[0] as any)?.text ?? "", 0, 0); },
  });
}
