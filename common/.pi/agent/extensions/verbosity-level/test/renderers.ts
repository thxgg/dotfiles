import type { ToolRenderers } from "@earendil-works/pi-coding-agent";

/** Mirror Pi's runtime erasure of factory-specific schema/state types for rendering. */
export function renderersOf(tool: object): ToolRenderers {
  // SAFETY: tests pass real tool factories and supply matching arguments/results to the host.
  // Pi's ToolRenderers uses unknown arguments and cannot express that schema relationship.
  return tool as ToolRenderers;
}
