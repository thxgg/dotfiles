import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { jobStore } from "../subagents/job-store.ts";
import type { AgentJobSnapshot } from "../subagents/job-types.ts";
import type { WorkflowDetails } from "./model.ts";
import { listWorkflows } from "./store.ts";

export type ActivityKind = "subagent" | "workflow" | "shell" | "session";
export type ActivityState = "queued" | "working" | "needs-input" | "idle" | "completed" | "failed" | "stopped";
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  state: ActivityState;
  headline: string;
  startedAt: number;
  updatedAt: number;
  parentId?: string;
}
export interface ActivityAdapter<T> {
  kind: ActivityKind;
  list(): T[];
  project(value: T): ActivityItem;
}

export const subagentActivityAdapter: ActivityAdapter<AgentJobSnapshot> = {
  kind: "subagent",
  list: () => jobStore.list(),
  project(job) {
    const state: ActivityState = job.status === "waiting" ? "needs-input" : job.status === "queued" ? "queued" : job.status === "running" ? "working" : job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "stopped";
    return { id: job.id, kind: "subagent", title: job.agent, state, headline: job.activity?.summary ?? job.result?.summary ?? job.error ?? job.task, startedAt: Date.parse(job.startedAt), updatedAt: Date.parse(job.updatedAt ?? job.endedAt ?? job.startedAt), parentId: job.owner?.sessionId };
  },
};
export const workflowActivityAdapter: ActivityAdapter<WorkflowDetails> = {
  kind: "workflow",
  list: listWorkflows,
  project(run) {
    const state: ActivityState = run.status === "running" ? "working" : run.status === "paused" ? "idle" : run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "stopped";
    const complete = run.agents.filter((agent) => agent.state === "done").length;
    return { id: run.runId, kind: "workflow", title: run.name ?? run.runId, state, headline: `${complete}/${run.agents.length} agents${run.currentPhase ? ` · ${run.currentPhase}` : ""}${run.error ? ` · ${run.error}` : ""}`, startedAt: run.startedAt, updatedAt: run.finishedAt ?? Date.now(), parentId: run.sessionId };
  },
};

const STATE_ORDER: Record<ActivityState, number> = { "needs-input": 0, working: 1, queued: 2, idle: 3, failed: 4, stopped: 5, completed: 6 };
export class ActivityDashboard {
  private items: ActivityItem[] = [];
  private index = 0;
  private timer: ReturnType<typeof setInterval>;
  constructor(private tui: TUI, private theme: ExtensionContext["ui"]["theme"], private keys: KeybindingsManager, private adapters: ActivityAdapter<any>[], private close: () => void) { this.refresh(); this.timer = setInterval(() => { this.refresh(); this.tui.requestRender(); }, 500); this.timer.unref?.(); }
  dispose(): void { clearInterval(this.timer); }
  invalidate(): void {}
  private refresh(): void { const selected = this.items[this.index]?.id; this.items = this.adapters.flatMap((adapter) => adapter.list().map((value) => adapter.project(value))).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.updatedAt - a.updatedAt); if (selected) { const index = this.items.findIndex((item) => item.id === selected); if (index >= 0) this.index = index; } this.index = Math.min(this.index, Math.max(0, this.items.length - 1)); }
  handleInput(data: string): void { const up = this.keys.matches(data, "tui.select.up") || data === "k"; const down = this.keys.matches(data, "tui.select.down") || data === "j"; const esc = this.keys.matches(data, "tui.select.cancel"); if (up && this.items.length) this.index = (this.index - 1 + this.items.length) % this.items.length; else if (down && this.items.length) this.index = (this.index + 1) % this.items.length; else if (esc) { this.dispose(); this.close(); return; } this.tui.requestRender(); }
  render(width: number): string[] { const lines = [this.theme.bold(this.theme.fg("accent", "Activity")), this.theme.fg("dim", "Unified presentation; each domain keeps its own lifecycle and controls."), ""]; if (!this.items.length) lines.push(this.theme.fg("dim", "No activity.")); let state: ActivityState | undefined; for (const [index, item] of this.items.entries()) { if (item.state !== state) { if (state) lines.push(""); lines.push(this.theme.bold(item.state.replace("-", " ").toUpperCase())); state = item.state; } const marker = index === this.index ? this.theme.fg("accent", "❯") : " "; const color = item.state === "completed" ? "success" : item.state === "failed" || item.state === "stopped" ? "error" : item.state === "needs-input" ? "warning" : "accent"; lines.push(`${marker} ${this.theme.fg(color, "■")} ${this.theme.fg(index === this.index ? "accent" : "text", item.title)} ${this.theme.fg("muted", `[${item.kind}] ${item.headline}`)}`); } lines.push("", this.theme.fg("dim", "↑↓ select · esc close · open /agents or /workflows for domain actions")); return lines.map((line) => truncateToWidth(line, width, "…")); }
}
export async function showActivityDashboard(ctx: ExtensionContext, adapters: ActivityAdapter<any>[] = [subagentActivityAdapter, workflowActivityAdapter]): Promise<void> { await ctx.ui.custom<void>((tui, theme, keys, done) => { let dashboard: ActivityDashboard; dashboard = new ActivityDashboard(tui, theme, keys, adapters, () => done(undefined)); return dashboard; }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } }); }
