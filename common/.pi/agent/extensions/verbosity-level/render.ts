import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { RenderRequest } from "./adapter.ts";
import { Activity, summary } from "./model.ts";

export function activityComponent(activity: Activity, request: RenderRequest, enabled: () => boolean, adapted: (id: string) => boolean = () => true): Component {
  const call = activity.calls.get(request.context.toolCallId);
  if (call && activity.host(call)) {
    const group = activity.group(call.group)!;
    const state = request.context.state as { verbosityGlobalExpanded?: boolean };
    if (state.verbosityGlobalExpanded !== request.context.expanded) {
      if (state.verbosityGlobalExpanded !== undefined || request.context.expanded) group.expanded = request.context.expanded;
      state.verbosityGlobalExpanded = request.context.expanded;
    }
  }
  let headerHeight = 0;
  return {
    invalidate() {},
    render(width) {
      const call = activity.calls.get(request.context.toolCallId);
      if (!enabled() || !call || call.outside) return request.normal.render(width);
      const group = activity.group(call.group)!;
      const calls = activity.members(group);
      // A competing owner can replace a tool after discovery. Fail open, not invisible.
      if (!adapted(calls[0]!.id)) return request.normal.render(width);
      if (!activity.host(call)) return group.expanded ? request.normal.render(width) : [];
      const failed = calls.some(c => c.status === "error");
      const busy = calls.some(c => c.status === "running" || c.status === "queued");
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      const arrow = group.expanded ? "▾" : "▸";
      const indicator = busy ? `${arrow} ${frames[Math.floor(Date.now() / 80) % frames.length]}` : arrow;
      const lines = [request.theme.fg(failed ? "error" : "accent", `${indicator} ${failed ? "FAILED · " : ""}${summary(calls)}`)];
      const header = lines.map(line => truncateToWidth(line, Math.max(0, width)));
      const spaced = request.standaloneSpacing ? ["", ...header] : header;
      headerHeight = spaced.length;
      return group.expanded ? [...spaced, ...request.normal.render(width)] : spaced;
    },
    handleMouse(event) {
      const call = activity.calls.get(request.context.toolCallId);
      if (!enabled() || !call || call.outside) return;
      const group = activity.group(call.group)!;
      if (!adapted(activity.members(group)[0]!.id)) return;
      if (!activity.host(call) && !group.expanded) return;
      const host = activity.host(call);
      const failed = activity.members(group).some(member => member.status === "error");
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
