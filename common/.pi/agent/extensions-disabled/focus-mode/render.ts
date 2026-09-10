import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { RenderRequest } from "./adapter.ts";
import { Activity, summary } from "./model.ts";

export function activityComponent(activity: Activity, request: RenderRequest, enabled: () => boolean, adapted: (id: string) => boolean = () => true): Component {
  const call = activity.calls.get(request.context.toolCallId);
  if (call && activity.host(call)) {
    const group = activity.group(call.group)!;
    const state = request.context.state as { focusGlobalExpanded?: boolean };
    if (state.focusGlobalExpanded !== request.context.expanded) {
      if (state.focusGlobalExpanded !== undefined || request.context.expanded) group.expanded = request.context.expanded;
      state.focusGlobalExpanded = request.context.expanded;
    }
  }
  return {
    invalidate() {},
    render(width) {
      const call = activity.calls.get(request.context.toolCallId);
      if (!enabled() || !call || call.outside) return request.normal.render(width);
      const group = activity.group(call.group)!;
      const calls = activity.members(group);
      // A competing owner can replace a tool after discovery. Fail open, not invisible.
      if (!adapted(calls[0]!.id)) return request.normal.render(width);
      if (!activity.host(call)) return group.expanded ? (request.expandedNormal ?? request.normal).render(width) : [];
      const failed = calls.some(c => c.status === "error");
      const expanded = group.expanded;
      const lines = [request.theme.fg(failed ? "error" : "accent", `${expanded ? "▾" : "▸"} ${failed ? "FAILED · " : ""}${summary(calls)}`)];
      if (expanded) {
        const icons = { queued: "○", running: "…", success: "✓", error: "✗", cancelled: "⊘", interrupted: "?" };
        for (const item of calls.slice(0, 20)) lines.push(request.theme.fg(item.status === "error" ? "error" : "muted", `  ${icons[item.status]} ${item.label}`));
        if (calls.length > 20) lines.push(`  … ${calls.length - 20} more calls`);
      }
      if (expanded || failed) lines.push(request.theme.fg("dim", `/focus details ${group.id}`));
      const header = lines.map(line => truncateToWidth(line, Math.max(0, width)));
      return expanded ? [...header, ...(request.expandedNormal ?? request.normal).render(width)] : header;
    },
    handleMouse(event) {
      const call = activity.calls.get(request.context.toolCallId);
      if (!enabled() || !call || call.outside) return;
      const group = activity.group(call.group)!;
      if (!adapted(activity.members(group)[0]!.id)) return;
      if (!activity.host(call) && !group.expanded) return;
      if (event.type !== "click" || event.button !== "left") return;
      group.expanded = !group.expanded;
      request.context.invalidate();
      return { handled: true }; // Do not take focus from the editor.
    },
  };
}
