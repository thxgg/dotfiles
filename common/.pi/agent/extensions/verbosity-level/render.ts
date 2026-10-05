import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { RenderRequest } from "./adapter.ts";
import { Activity, summary, type Call } from "./model.ts";

const globalExpansion = new WeakMap<object, boolean>();

function codemodeSummary(call: Call): string {
  const busy = call.status === "running" || call.status === "queued";
  const nested = call.nested?.map(item => item.status === "running" && !busy ? { ...item, status: "interrupted" as const } : item);
  const label = nested?.length ? summary(nested) : busy ? "Running script" : "Script finished";
  const outcome = call.status === "error" ? " · script FAILED"
    : call.status === "cancelled" ? " · script cancelled"
    : call.status === "interrupted" ? " · script interrupted" : "";
  return `Codemode · ${label}${outcome}`;
}

function missingCodemodeDetails(call: Call): boolean {
  return call.name === "codemode" && !call.nested && call.status !== "running" && call.status !== "queued";
}

export function activityComponent(activity: Activity, request: RenderRequest, enabled: () => boolean, adapted: (id: string) => boolean = () => true): Component {
  const call = activity.calls.get(request.context.toolCallId);
  const initialGroup = call && activity.host(call) ? activity.group(call.group) : undefined;
  if (initialGroup) {
    const previous = globalExpansion.get(request.context.state);
    if (previous !== request.context.expanded) {
      if (previous !== undefined || request.context.expanded) initialGroup.expanded = request.context.expanded;
      globalExpansion.set(request.context.state, request.context.expanded);
    }
  }
  const grouped = () => {
    const call = activity.calls.get(request.context.toolCallId);
    if (!enabled() || !call || call.outside || missingCodemodeDetails(call)) return;
    const group = activity.group(call.group);
    if (!group) return;
    const calls = activity.members(group);
    const host = calls[0];
    // A downstream renderer may be unavailable. Never hide a row without a summary host.
    if (!host || !adapted(host.id)) return;
    return { call, group, calls, host: host.id === call.id };
  };
  let headerHeight = 0;
  return {
    invalidate() {},
    render(width) {
      const state = grouped();
      if (!state) return request.normal.render(width);
      const { call, group, calls, host } = state;
      if (!host) return group.expanded ? request.normal.render(width) : [];
      const failed = calls.some(c => c.status === "error" || c.nested?.some(n => n.status === "error"));
      const busy = calls.some(c => c.status === "running" || c.status === "queued");
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      const arrow = group.expanded ? "▾" : "▸";
      const indicator = busy ? `${arrow} ${frames[Math.floor(Date.now() / 80) % frames.length]}` : arrow;
      const label = call.name === "codemode" ? codemodeSummary(call) : summary(calls);
      const header = [truncateToWidth(request.theme.fg(failed ? "error" : "accent", `${indicator} ${label}`), Math.max(0, width))];
      const spaced = request.standaloneSpacing ? ["", ...header] : header;
      headerHeight = spaced.length;
      const content = call.name === "codemode" ? request.expandedNormal ?? request.normal : request.normal;
      return group.expanded ? [...spaced, ...content.render(width)] : spaced;
    },
    handleMouse(event) {
      const state = grouped();
      if (!state) return request.normal.handleMouse?.(event);
      const { group, host } = state;
      if (!host && !group.expanded) return;
      const offset = host ? (headerHeight || 1 + (request.standaloneSpacing ? 1 : 0)) : 0;
      if (group.expanded && (!host || event.y >= offset)) {
        return request.normal.handleMouse?.({ ...event, y: event.y - offset, height: Math.max(0, event.height - offset) });
      }
      if (!host || (request.standaloneSpacing && event.y === 0)) return;
      if (event.type !== "click" || event.button !== "left") return;
      group.expanded = !group.expanded;
      request.context.invalidate();
      return { handled: true }; // Do not take focus from the editor.
    },
  };
}
