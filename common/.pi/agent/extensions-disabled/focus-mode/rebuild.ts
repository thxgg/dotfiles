import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Activity } from "./model.ts";

// 0.85.1 runtime supports retainedTail, but its published declaration omits it.
export function retainedMessages(entry: SessionEntry): Extract<SessionEntry, { type: "message" }>["message"][] {
  if (!("retainedTail" in entry) || !Array.isArray(entry.retainedTail)) return [];
  return entry.retainedTail.filter(message => message && typeof message === "object" && typeof message.role === "string");
}

export const BOUNDARY_ENTRY = "dotfiles:focus:boundary:v1";
export const OUTSIDE_ENTRY = "dotfiles:focus:outside:v1";

/** Pass buildContextEntries(), never getEntries(): match the visible active branch. */
export function reconstruct(entries: readonly SessionEntry[], supported: Set<string>): Activity {
  const activity = new Activity(supported);
  const outside: string[] = [];
  for (const entry of entries) {
    if (entry.type === "message") activity.message(entry.message);
    else if (entry.type === "compaction") {
      activity.boundary();
      for (const message of retainedMessages(entry)) activity.message(message);
    } else if (entry.type === "custom") {
      // Other display-only entries can have renderers. Conservatively separate them.
      activity.boundary();
      if (entry.customType === OUTSIDE_ENTRY && Array.isArray(entry.data)) {
        outside.push(...entry.data.filter((id): id is string => typeof id === "string"));
      }
    } else if (entry.type === "branch_summary" || (entry.type === "custom_message" && entry.display)) activity.boundary();
  }
  for (const id of outside) activity.exclude(id);
  activity.settle();
  return activity;
}
