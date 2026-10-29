import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Activity } from "./model.ts";

// 0.85.1 runtime supports retainedTail, but its published declaration omits it.
export function retainedMessages(entry: SessionEntry): Extract<SessionEntry, { type: "message" }>["message"][] {
  if (!("retainedTail" in entry) || !Array.isArray(entry.retainedTail)) return [];
  return entry.retainedTail.filter(message => message && typeof message === "object" && typeof message.role === "string");
}

// Legacy prompt markers. They remain in saved sessions but no longer affect grouping.
export const BOUNDARY_ENTRY = "dotfiles:verbosity:boundary:v1";
export const OUTSIDE_ENTRY = "dotfiles:verbosity:outside:v1";

/** Share the same entry boundaries between live reconciliation and history. */
export function separatesEntry(entry: SessionEntry): boolean {
  return entry.type === "branch_summary"
    || (entry.type === "custom_message" && entry.display);
}

/** Pass buildContextEntries(), never getEntries(): match the visible active branch. */
export function reconstruct(entries: readonly SessionEntry[], supported: Set<string>): Activity {
  const activity = new Activity(supported);
  for (const entry of entries) {
    if (entry.type === "message") activity.message(entry.message);
    else if (entry.type === "compaction") {
      activity.boundary();
      for (const message of retainedMessages(entry)) activity.message(message);
    } else if (separatesEntry(entry)) activity.boundary();
  }
  activity.settle();
  return activity;
}
