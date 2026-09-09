import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Activity, safeLabel, summary } from "./model.ts";
import { retainedMessages } from "./rebuild.ts";
import { detailPreview } from "./preview.ts";

export async function showDetails(ctx: ExtensionContext, activity: Activity, groupId?: string): Promise<void> {
  let groups = activity.groups.filter(g => g.calls.length);
  if (!groups.length) { ctx.ui.notify("No exploration activity in this branch.", "info"); return; }
  let groupIndex = groupId ? groups.findIndex(g => g.id === groupId) : groups.length - 1;
  if (groupIndex < 0) { ctx.ui.notify("Activity group not found.", "warning"); return; }
  let callIndex = 0;
  let offset = 0;
  let showingResult = false;
  let preview = "";
  let selectedId = groups[groupIndex]!.calls[0]!.id;
  const synchronize = () => {
    groups = activity.groups.filter(g => g.calls.length);
    const index = groups.findIndex(group => group.calls.some(call => call.id === selectedId));
    if (index >= 0) {
      groupIndex = index;
      callIndex = groups[index]!.calls.findIndex(call => call.id === selectedId);
    }
  };
  const loadResult = () => {
    const call = groups[groupIndex]!.calls[callIndex]!;
    // Read on demand. Do not cache results or image data in the activity model.
    let message;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === call.id) message = entry.message;
      if (entry.type === "compaction") for (const item of retainedMessages(entry)) {
        if (item.role === "toolResult" && item.toolCallId === call.id) message = item;
      }
    }
    if (!message) { preview = "No saved result yet. The call can still be running or was interrupted."; return; }
    const parts: string[] = [];
    let remaining = 64 * 1024;
    for (const part of message.content) {
      const text = part.type === "text" ? part.text : `[Image: ${part.mimeType}; shown in the normal transcript]`;
      parts.push(text.slice(0, remaining));
      remaining -= Math.min(text.length, remaining);
      if (remaining === 0) { parts.push("[Preview limit: use /focus off for the original result]"); break; }
    }
    if (message.details !== undefined) {
      parts.push(`\nDetails (preview):\n${detailPreview(message.details)}`);
    }
    preview = parts.join("\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ");
  };
  await ctx.ui.custom<void>((tui, _theme, keys, done) => ({
    invalidate() {},
    render(width) {
      synchronize();
      const group = groups[groupIndex]!;
      const call = group.calls[callIndex]!;
      const theme = ctx.ui.theme;
      const height = Math.max(1, tui.terminal.rows - 8);
      const header = [theme.fg("accent", `${groupIndex + 1}/${groups.length} ${summary(group.calls)}`),
        theme.fg(call.status === "error" ? "error" : "muted", `${callIndex + 1}/${group.calls.length} ${call.status}: ${call.label}`)];
      const body = showingResult ? wrapTextWithAnsi(preview, Math.max(1, width)) : group.calls.map((c, i) => `${i === callIndex ? "›" : " "} ${c.status}: ${safeLabel(c.label)}`);
      if (!showingResult) offset = Math.max(0, callIndex - Math.floor(height / 2));
      offset = Math.max(0, Math.min(offset, Math.max(0, body.length - height)));
      const help = showingResult ? "↑↓/PgUp/PgDn scroll · Esc back · /focus off: original display" : "←→ groups · ↑↓ calls · Enter result · Space expand group · Esc close";
      return [...header, ...body.slice(offset, offset + height), theme.fg("dim", help)].map(line => truncateToWidth(line, Math.max(0, width)));
    },
    handleInput(data) {
      synchronize();
      if (keys.matches(data, "tui.select.cancel")) {
        if (showingResult) { showingResult = false; offset = 0; } else done();
      } else if (showingResult) {
        if (keys.matches(data, "tui.select.up")) offset--;
        if (keys.matches(data, "tui.select.down")) offset++;
        if (keys.matches(data, "tui.select.pageUp")) offset -= 10;
        if (keys.matches(data, "tui.select.pageDown")) offset += 10;
      } else {
        if (matchesKey(data, "left")) groupIndex = Math.max(0, groupIndex - 1);
        if (matchesKey(data, "right")) groupIndex = Math.min(groups.length - 1, groupIndex + 1);
        if (keys.matches(data, "tui.select.up")) callIndex--;
        if (keys.matches(data, "tui.select.down")) callIndex++;
        callIndex = Math.max(0, Math.min(callIndex, groups[groupIndex]!.calls.length - 1));
        if (matchesKey(data, "space")) groups[groupIndex]!.expanded = !groups[groupIndex]!.expanded;
        if (keys.matches(data, "tui.select.confirm")) { loadResult(); showingResult = true; offset = 0; }
      }
      selectedId = groups[groupIndex]!.calls[callIndex]!.id;
      tui.requestRender();
    },
  }));
}
