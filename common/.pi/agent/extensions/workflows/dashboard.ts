import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import type { WorkflowAgentRecord, WorkflowDetails } from "./model.ts";
import { formatElapsed } from "./model.ts";
import { listWorkflows } from "./store.ts";

type View = "runs" | "detail" | "transcript";
type DetailFocus = "phases" | "agents";
interface PhaseGroup { title: string; agents: WorkflowAgentRecord[]; }
export interface WorkflowDashboardActions {
  cancel(runId: string): Promise<void>;
  restart(runId: string): Promise<void>;
  saveReport(runId: string): Promise<string>;
}
function wrap(index: number, delta: number, length: number): number { return length ? (index + delta + length) % length : 0; }
function groups(run: WorkflowDetails): PhaseGroup[] {
  const values = run.phases.map((phase) => ({ title: phase.title, agents: run.agents.filter((agent) => agent.phase === phase.title) }));
  const ungrouped = run.agents.filter((agent) => !agent.phase || !run.phases.some((phase) => phase.title === agent.phase));
  if (ungrouped.length) values.push({ title: "Other", agents: ungrouped });
  return values.length ? values : [{ title: run.currentPhase ?? "Agents", agents: run.agents }];
}
export class WorkflowDashboard {
  private runs: WorkflowDetails[] = [];
  private notice?: string;
  private runIndex = 0;
  private phaseIndex = 0;
  private agentIndex = 0;
  private transcriptOffset = 0;
  private view: View;
  private focus: DetailFocus = "phases";
  private timer: ReturnType<typeof setInterval>;
  constructor(private tui: TUI, private theme: ExtensionContext["ui"]["theme"], private keys: KeybindingsManager, private active: () => Map<string, WorkflowDetails>, private actions: WorkflowDashboardActions, private close: () => void, initialRunId?: string) {
    this.refresh();
    const initial = initialRunId ? this.runs.findIndex((run) => run.runId === initialRunId) : -1;
    if (initial >= 0) { this.runIndex = initial; this.view = "detail"; } else this.view = "runs";
    this.timer = setInterval(() => { this.refresh(); this.tui.requestRender(); }, 500); this.timer.unref?.();
  }
  dispose(): void { clearInterval(this.timer); }
  invalidate(): void {}
  private refresh(): void {
    const selected = this.runs[this.runIndex]?.runId;
    const merged = new Map(listWorkflows().map((run) => [run.runId, run]));
    for (const [id, run] of this.active()) merged.set(id, run);
    this.runs = [...merged.values()].sort((a, b) => b.startedAt - a.startedAt);
    if (selected) { const index = this.runs.findIndex((run) => run.runId === selected); if (index >= 0) this.runIndex = index; }
    this.runIndex = Math.min(this.runIndex, Math.max(0, this.runs.length - 1));
    const phaseValues = this.current() ? groups(this.current()!) : [];
    this.phaseIndex = Math.min(this.phaseIndex, Math.max(0, phaseValues.length - 1));
    this.agentIndex = Math.min(this.agentIndex, Math.max(0, (phaseValues[this.phaseIndex]?.agents.length ?? 1) - 1));
  }
  private current(): WorkflowDetails | undefined { return this.runs[this.runIndex]; }
  private currentGroups(): PhaseGroup[] { const run = this.current(); return run ? groups(run) : []; }
  private currentAgent(): WorkflowAgentRecord | undefined { return this.currentGroups()[this.phaseIndex]?.agents[this.agentIndex]; }
  handleInput(data: string): void {
    const up = this.keys.matches(data, "tui.select.up") || data === "k";
    const down = this.keys.matches(data, "tui.select.down") || data === "j";
    const left = this.keys.matches(data, "tui.editor.cursorLeft") || data === "h";
    const right = this.keys.matches(data, "tui.editor.cursorRight") || data === "l";
    const enter = this.keys.matches(data, "tui.select.confirm");
    const esc = this.keys.matches(data, "tui.select.cancel");
    if (this.view === "runs") {
      if (up) this.runIndex = wrap(this.runIndex, -1, this.runs.length);
      else if (down) this.runIndex = wrap(this.runIndex, 1, this.runs.length);
      else if (enter && this.current()) { this.view = "detail"; this.phaseIndex = 0; this.agentIndex = 0; this.focus = "phases"; }
      else if (esc) { this.dispose(); this.close(); return; }
    } else if (this.view === "detail") {
      const phaseValues = this.currentGroups();
      const agents = phaseValues[this.phaseIndex]?.agents ?? [];
      if (this.focus === "phases" && up) { this.phaseIndex = wrap(this.phaseIndex, -1, phaseValues.length); this.agentIndex = 0; }
      else if (this.focus === "phases" && down) { this.phaseIndex = wrap(this.phaseIndex, 1, phaseValues.length); this.agentIndex = 0; }
      else if (this.focus === "agents" && up) this.agentIndex = wrap(this.agentIndex, -1, agents.length);
      else if (this.focus === "agents" && down) this.agentIndex = wrap(this.agentIndex, 1, agents.length);
      else if ((right || enter) && this.focus === "phases" && agents.length) this.focus = "agents";
      else if (left && this.focus === "agents") this.focus = "phases";
      else if (left && this.focus === "phases") this.view = "runs";
      else if (enter && this.focus === "agents" && this.currentAgent()) { this.view = "transcript"; this.transcriptOffset = 0; }
      else if (data === "b") { this.view = "runs"; this.focus = "phases"; }
      else if (esc) { this.dispose(); this.close(); return; }
      else if (this.current() && ["x", "r", "s"].includes(data)) {
        const runId = this.current()!.runId;
        const action = data === "x" ? this.actions.cancel(runId).then(() => `Cancellation requested for ${runId}`) : data === "r" ? this.actions.restart(runId).then(() => `Restarted ${runId}`) : this.actions.saveReport(runId);
        void action.then((notice) => { this.notice = notice; this.refresh(); this.tui.requestRender(); }).catch((error) => { this.notice = error instanceof Error ? error.message : String(error); this.tui.requestRender(); });
      }
    } else {
      if (up) this.transcriptOffset = Math.max(0, this.transcriptOffset - (data === "k" ? 10 : 1));
      else if (down) this.transcriptOffset += data === "j" ? 10 : 1;
      else if (esc || left) { this.view = "detail"; this.focus = "agents"; this.transcriptOffset = 0; }
    }
    this.tui.requestRender();
  }
  private split(left: string, right: string, width: number): string {
    const rightWidth = visibleWidth(right); const clipped = truncateToWidth(left, Math.max(0, width - rightWidth - 2), "…");
    return clipped + " ".repeat(Math.max(1, width - visibleWidth(clipped) - rightWidth)) + right;
  }
  private panel(title: string, rows: string[], width: number, height: number): string[] {
    const inner = Math.max(1, width - 2); const border = (value: string) => this.theme.fg("borderMuted", value); const label = truncateToWidth(` ${title} `, Math.max(1, inner - 2), "…");
    const lines = [border("╭─") + label + border("─".repeat(Math.max(0, inner - visibleWidth(label) - 1)) + "╮")];
    for (let index = 0; index < Math.max(0, height - 2); index++) { const row = truncateToWidth(rows[index] ?? "", inner, "…"); lines.push(border("│") + row + " ".repeat(Math.max(0, inner - visibleWidth(row))) + border("│")); }
    lines.push(border("╰" + "─".repeat(inner) + "╯")); return lines;
  }
  private renderRuns(width: number, height: number): string[] {
    const rows = this.runs.map((run, index) => { const done = run.agents.filter((agent) => agent.state === "done").length; const failed = run.agents.filter((agent) => agent.state === "error").length; const marker = index === this.runIndex ? this.theme.fg("accent", "❯") : " "; const color = run.status === "completed" ? "success" : run.status === "running" ? "warning" : "error"; return this.split(`${marker} ${this.theme.fg(color, "■")} ${this.theme.fg(index === this.runIndex ? "accent" : "text", run.name ?? run.runId)}`, this.theme.fg("dim", `${done}/${run.agents.length}${failed ? ` · ${failed} failed` : ""} · ${formatElapsed(run.startedAt, run.finishedAt)} · ${run.status}`), Math.max(1, width - 2)); });
    return [this.split(this.theme.bold(this.theme.fg("accent", " Workflows")), this.theme.fg("dim", `${this.runs.length} runs `), width), ...this.panel("Runs", rows, width, height - 2), this.theme.fg("dim", " ↑↓ select · enter inspect · esc close")];
  }
  private renderDetail(width: number, height: number): string[] {
    const run = this.current()!; const phaseValues = this.currentGroups(); const done = run.agents.filter((agent) => agent.state === "done").length; const failed = run.agents.filter((agent) => agent.state === "error").length;
    const header = this.split(` ${this.theme.bold(this.theme.fg("accent", run.name ?? run.runId))}`, this.theme.fg("dim", `${done}/${run.agents.length} agents${failed ? ` · ${failed} failed` : ""} · ${formatElapsed(run.startedAt, run.finishedAt)} · ${run.status} `), width);
    const description = truncateToWidth(` ${run.description ?? run.error ?? run.currentPhase ?? "Workflow run"}`, width, "…");
    const panelHeight = Math.max(6, height - 4); const leftWidth = Math.max(24, Math.min(38, Math.floor(width * 0.3))); const rightWidth = Math.max(20, width - leftWidth - 1);
    const phaseRows = phaseValues.map((phase, index) => { const complete = phase.agents.filter((agent) => agent.state === "done").length; const marker = this.focus === "phases" && index === this.phaseIndex ? this.theme.fg("accent", "❯") : " "; return this.split(`${marker} ${this.theme.fg(index === this.phaseIndex ? "accent" : "text", phase.title)}`, this.theme.fg("dim", `${complete}/${phase.agents.length}`), leftWidth - 2); });
    const agents = phaseValues[this.phaseIndex]?.agents ?? [];
    const agentRows = agents.map((agent, index) => { const marker = this.focus === "agents" && index === this.agentIndex ? this.theme.fg("accent", "❯") : " "; const color = agent.state === "done" ? "success" : agent.state === "running" || agent.state === "queued" ? "warning" : "error"; const right = [agent.model, formatElapsed(agent.startedAt, agent.finishedAt), agent.state].filter(Boolean).join(" · "); return this.split(`${marker} ${this.theme.fg(color, "■")} ${this.theme.fg(index === this.agentIndex ? "accent" : "text", agent.label)}`, this.theme.fg("dim", right), rightWidth - 2); });
    const left = this.panel("Phases", phaseRows, leftWidth, panelHeight); const right = this.panel(`${phaseValues[this.phaseIndex]?.title ?? "Agents"} · ${agents.length} agents`, agentRows, rightWidth, panelHeight);
    const body = left.map((line, index) => line + " " + (right[index] ?? ""));
    return [header, this.theme.fg("dim", description), ...body, this.theme.fg("dim", ` ${this.focus === "phases" ? "↑↓ phase · ← all workflows · →/enter agents" : "↑↓ agent · ← phases · enter transcript"} · x cancel · r restart · s save report · b all workflows · esc close${this.notice ? ` · ${this.notice}` : ""}`)];
  }
  private renderTranscript(width: number, height: number): string[] {
    const run = this.current()!; const agent = this.currentAgent()!; const body: string[] = [];
    for (const entry of agent.transcript.slice(-100)) { const color = entry.isError ? "error" : entry.role === "tool" ? "warning" : entry.role === "thinking" ? "dim" : "text"; body.push(...wrapTextWithAnsi(this.theme.fg(color, `${entry.role}${entry.name ? ` ${entry.name}` : ""}: ${entry.text}`), Math.max(1, width - 2))); }
    const viewport = Math.max(5, height - 4); const maxOffset = Math.max(0, body.length - viewport); this.transcriptOffset = Math.min(this.transcriptOffset, maxOffset); const start = Math.max(0, body.length - viewport - this.transcriptOffset);
    return [this.split(` ${this.theme.bold(agent.label)}`, this.theme.fg("dim", `${run.name ?? run.runId} · ${agent.phase ?? "unphased"} · ${agent.state} `), width), ...this.panel("Transcript", body.slice(start, start + viewport), width, viewport + 2), this.theme.fg("dim", " ↑↓ scroll · ←/esc agents")];
  }
  render(width: number): string[] { const height = Math.max(12, Math.floor(this.tui.terminal.rows * 0.86)); const lines = this.view === "runs" ? this.renderRuns(width, height) : this.view === "detail" ? this.renderDetail(width, height) : this.renderTranscript(width, height); return lines.map((line) => truncateToWidth(line, width, "")); }
}
export async function showWorkflowDashboard(ctx: ExtensionContext, active: () => Map<string, WorkflowDetails>, actions: WorkflowDashboardActions, initialRunId?: string): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, keys, done) => { let dashboard: WorkflowDashboard; dashboard = new WorkflowDashboard(tui, theme, keys, active, actions, () => done(undefined), initialRunId); return dashboard; }, { overlay: true, overlayOptions: { anchor: "center", width: "92%", maxHeight: "90%", margin: 1 } });
}
