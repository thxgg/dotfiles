import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import type { AgentJobSnapshot } from "./job-types.ts";
import { isTerminalStatus } from "./job-types.ts";

function group(job: AgentJobSnapshot): "Needs input" | "Working" | "Completed" {
  if (job.status === "waiting") return "Needs input";
  if (!isTerminalStatus(job.status)) return "Working";
  return "Completed";
}
function elapsed(job: AgentJobSnapshot): string {
  const seconds = Math.max(0, Math.round((Date.parse(job.endedAt ?? new Date().toISOString()) - Date.parse(job.startedAt)) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}
export interface SubagentDashboardActions {
  focus(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  approve(jobId: string): Promise<void>;
  deny(jobId: string): Promise<void>;
  apply(jobId: string): Promise<void>;
  retain(jobId: string): Promise<void>;
  discard(jobId: string): Promise<void>;
}

export class SubagentDashboard {
  private jobs: AgentJobSnapshot[] = [];
  private notice?: string;
  private index = 0;
  private detail = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(private tui: TUI, private theme: ExtensionContext["ui"]["theme"], private keys: KeybindingsManager, private getJobs: () => AgentJobSnapshot[], private actions: SubagentDashboardActions, private close: () => void) {
    this.refresh(); this.timer = setInterval(() => { this.refresh(); this.tui.requestRender(); }, 500); this.timer.unref?.();
  }
  dispose(): void { clearInterval(this.timer); }
  invalidate(): void {}
  private refresh(): void { const selected = this.jobs[this.index]?.id; this.jobs = this.getJobs().sort((a, b) => { const order = { "Needs input": 0, Working: 1, Completed: 2 }; return order[group(a)] - order[group(b)] || b.startedAt.localeCompare(a.startedAt); }); if (selected) { const index = this.jobs.findIndex((job) => job.id === selected); if (index >= 0) this.index = index; } this.index = Math.min(this.index, Math.max(0, this.jobs.length - 1)); }
  handleInput(data: string): void {
    const up = this.keys.matches(data, "tui.select.up") || data === "k"; const down = this.keys.matches(data, "tui.select.down") || data === "j"; const enter = this.keys.matches(data, "tui.select.confirm"); const esc = this.keys.matches(data, "tui.select.cancel");
    if (up && this.jobs.length) this.index = (this.index - 1 + this.jobs.length) % this.jobs.length;
    else if (down && this.jobs.length) this.index = (this.index + 1) % this.jobs.length;
    else if (enter && this.jobs.length) this.detail = true;
    else if (this.detail && this.jobs[this.index]) {
      const jobId = this.jobs[this.index]!.id;
      const action = data === "f" ? this.actions.focus : data === "x" ? this.actions.cancel : data === "a" ? this.actions.approve : data === "d" ? this.actions.deny : data === "A" ? this.actions.apply : data === "R" ? this.actions.retain : data === "D" ? this.actions.discard : undefined;
      if (action) void action.call(this.actions, jobId).then(() => { this.notice = `Action applied to ${jobId}`; this.refresh(); this.tui.requestRender(); }).catch((error) => { this.notice = error instanceof Error ? error.message : String(error); this.tui.requestRender(); });
    }
    if (esc) { if (this.detail) this.detail = false; else { this.dispose(); this.close(); return; } }
    this.tui.requestRender();
  }
  render(width: number): string[] {
    const lines = [this.theme.bold(this.theme.fg("accent", "Subagents")), ""];
    if (!this.jobs.length) lines.push(this.theme.fg("dim", "No subagent jobs."));
    else if (this.detail) {
      const job = this.jobs[this.index]!;
      lines.push(`${this.theme.bold(job.agent)} ${this.theme.fg("muted", job.id)}`, this.theme.fg("dim", `${job.status} · ${job.backend} · ${elapsed(job)}`), "", `Task: ${job.task}`, "", job.permissionRequests?.length ? this.theme.fg("warning", `Needs permission: ${job.permissionRequests.map((request) => request.description).join("; ")}`) : job.result?.summary ?? job.error ?? job.activity?.summary ?? "No output yet.", "", this.theme.fg("dim", job.herdr ? `Herdr: ${job.herdr.agentName} (${job.herdr.tabId}/${job.herdr.paneId})` : "In-process child"), job.worktree ? this.theme.fg("dim", `Worktree: ${job.worktree.path}${job.worktree.appliedAt ? " · applied" : job.worktree.retained ? " · retained" : job.worktree.discardedAt ? " · discarded" : " · pending"}`) : "");
    } else {
      let last: string | undefined;
      for (const [index, job] of this.jobs.entries()) {
        const heading = group(job); if (heading !== last) { if (last) lines.push(""); lines.push(this.theme.bold(this.theme.fg(heading === "Needs input" ? "warning" : heading === "Completed" ? "muted" : "accent", heading))); last = heading; }
        const marker = index === this.index ? this.theme.fg("accent", "❯") : " "; const color = job.status === "completed" ? "success" : job.status === "failed" ? "error" : job.status === "waiting" ? "warning" : "accent";
        lines.push(`${marker} ${this.theme.fg(color, "■")} ${this.theme.fg(index === this.index ? "accent" : "text", job.agent)} ${this.theme.fg("dim", `${job.id} · ${job.activity?.summary ?? job.status} · ${elapsed(job)}`)}`);
      }
    }
    if (this.notice) lines.push("", this.theme.fg("accent", this.notice));
    lines.push("", this.theme.fg("dim", this.detail ? "f focus · x cancel · a/d allow/deny · A/R/D apply/retain/discard · esc list" : "↑↓ select · enter inspect · esc close"));
    return lines.filter((line) => line !== undefined).map((line) => truncateToWidth(line, width, "…"));
  }
}
export async function showSubagentDashboard(ctx: ExtensionContext, getJobs: () => AgentJobSnapshot[], actions: SubagentDashboardActions): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, keys, done) => { let dashboard: SubagentDashboard; dashboard = new SubagentDashboard(tui, theme, keys, getJobs, actions, () => done(undefined)); return dashboard; });
}
