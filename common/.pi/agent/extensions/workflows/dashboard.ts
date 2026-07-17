import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import type { WorkflowDetails } from "./model.ts";
import { formatElapsed } from "./model.ts";
import { listWorkflows } from "./store.ts";

type View = "runs" | "agents" | "transcript";
export interface WorkflowDashboardActions {
  cancel(runId: string): Promise<void>;
  restart(runId: string): Promise<void>;
  save(runId: string): Promise<void>;
}
export class WorkflowDashboard {
  private runs: WorkflowDetails[] = [];
  private notice?: string;
  private runIndex = 0;
  private agentIndex = 0;
  private view: View = "runs";
  private timer: ReturnType<typeof setInterval>;
  constructor(private tui: TUI, private theme: ExtensionContext["ui"]["theme"], private keys: KeybindingsManager, private active: () => Map<string, WorkflowDetails>, private actions: WorkflowDashboardActions, private close: () => void) {
    this.refresh(); this.timer = setInterval(() => { this.refresh(); this.tui.requestRender(); }, 500); this.timer.unref?.();
  }
  dispose(): void { clearInterval(this.timer); }
  invalidate(): void {}
  private refresh(): void {
    const merged = new Map(listWorkflows().map((run) => [run.runId, run]));
    for (const [id, run] of this.active()) merged.set(id, run);
    this.runs = [...merged.values()].sort((a, b) => b.startedAt - a.startedAt);
    this.runIndex = Math.min(this.runIndex, Math.max(0, this.runs.length - 1));
    this.agentIndex = Math.min(this.agentIndex, Math.max(0, (this.runs[this.runIndex]?.agents.length ?? 1) - 1));
  }
  handleInput(data: string): void {
    const up = this.keys.matches(data, "tui.select.up") || data === "k";
    const down = this.keys.matches(data, "tui.select.down") || data === "j";
    const enter = this.keys.matches(data, "tui.select.confirm");
    const esc = this.keys.matches(data, "tui.select.cancel");
    const values = this.view === "runs" ? this.runs.length : this.runs[this.runIndex]?.agents.length ?? 0;
    if (up && values) this.view === "runs" ? this.runIndex = (this.runIndex - 1 + values) % values : this.agentIndex = (this.agentIndex - 1 + values) % values;
    else if (down && values) this.view === "runs" ? this.runIndex = (this.runIndex + 1) % values : this.agentIndex = (this.agentIndex + 1) % values;
    else if (enter) this.view = this.view === "runs" ? "agents" : this.view === "agents" ? "transcript" : this.view;
    else if (this.view !== "transcript" && this.runs[this.runIndex] && ["x", "r", "s"].includes(data)) {
      const runId = this.runs[this.runIndex]!.runId;
      const action = data === "x" ? this.actions.cancel : data === "r" ? this.actions.restart : this.actions.save;
      void action.call(this.actions, runId).then(() => { this.notice = `${data === "x" ? "Cancelled" : data === "r" ? "Restarted" : "Saved"} ${runId}`; this.refresh(); this.tui.requestRender(); }).catch((error) => { this.notice = error instanceof Error ? error.message : String(error); this.tui.requestRender(); });
    }
    else if (esc) { if (this.view === "transcript") this.view = "agents"; else if (this.view === "agents") this.view = "runs"; else { this.dispose(); this.close(); return; } }
    this.tui.requestRender();
  }
  render(width: number): string[] {
    const lines: string[] = [this.theme.bold(this.theme.fg("accent", "Workflows")), ""];
    if (!this.runs.length) lines.push(this.theme.fg("dim", "No workflow runs yet."));
    else if (this.view === "runs") for (const [index, run] of this.runs.entries()) {
      const done = run.agents.filter((agent) => agent.state === "done").length;
      const failed = run.agents.filter((agent) => agent.state === "error").length;
      const marker = index === this.runIndex ? this.theme.fg("accent", "❯") : " ";
      const color = run.status === "completed" ? "success" : run.status === "running" ? "warning" : "error";
      lines.push(`${marker} ${this.theme.fg(color, "■")} ${this.theme.fg(index === this.runIndex ? "accent" : "text", run.name ?? run.runId)} ${this.theme.fg("dim", `${done}/${run.agents.length} ok${failed ? ` · ${failed} failed` : ""} · ${formatElapsed(run.startedAt, run.finishedAt)} · ${run.status}`)}`);
    } else {
      const run = this.runs[this.runIndex]!;
      lines.push(this.theme.fg("muted", `${run.name ?? run.runId} · ${run.currentPhase ?? run.status}`), "");
      if (this.view === "agents") for (const [index, agent] of run.agents.entries()) {
        const marker = index === this.agentIndex ? this.theme.fg("accent", "❯") : " ";
        const color = agent.state === "done" ? "success" : agent.state === "running" || agent.state === "queued" ? "warning" : "error";
        lines.push(`${marker} ${this.theme.fg(color, "■")} ${this.theme.fg(index === this.agentIndex ? "accent" : "text", agent.label)} ${this.theme.fg("dim", `${agent.phase ?? "unphased"} · ${formatElapsed(agent.startedAt, agent.finishedAt)}`)}`);
        if (agent.error) lines.push(`    ${this.theme.fg("error", agent.error)}`);
      } else {
        const agent = run.agents[this.agentIndex];
        if (!agent) lines.push(this.theme.fg("dim", "No agent selected."));
        else {
          lines.push(this.theme.bold(agent.label), this.theme.fg("dim", agent.preview || agent.error || "No output yet."), "");
          for (const entry of agent.transcript.slice(-30)) lines.push(this.theme.fg(entry.isError ? "error" : entry.role === "tool" ? "warning" : entry.role === "thinking" ? "dim" : "text", `${entry.role}${entry.name ? ` ${entry.name}` : ""}: ${entry.text}`));
        }
      }
    }
    if (this.notice) lines.push("", this.theme.fg("accent", this.notice));
    lines.push("", this.theme.fg("dim", this.view === "runs" ? "↑↓ select · enter open · x cancel · r restart · s save · esc close" : this.view === "agents" ? "↑↓ select · enter transcript · x/r/s run actions · esc runs" : "esc agents"));
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }
}
export async function showWorkflowDashboard(ctx: ExtensionContext, active: () => Map<string, WorkflowDetails>, actions: WorkflowDashboardActions): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, keys, done) => {
    let dashboard: WorkflowDashboard;
    dashboard = new WorkflowDashboard(tui, theme, keys, active, actions, () => done(undefined));
    return dashboard;
  }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } });
}
