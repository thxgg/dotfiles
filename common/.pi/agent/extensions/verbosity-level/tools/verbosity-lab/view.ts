import {
  AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent,
  createBashToolDefinition, createReadToolDefinition, createEditToolDefinition,
  createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { Activity } from "../../model.ts";
import { activityComponent } from "../../render.ts";
import { assistant, type Fixture } from "./fixtures.ts";
import { createWebFetchTool } from "../../../web-tools/webfetch.ts";
import { createWebSearchTool } from "../../../web-tools/websearch.ts";

/** The two display levels. Expansion is a separate inspection control. */
export type Verbosity = "low" | "default";
/** Replay the same event prefix through native Pi rows and the archived grouping renderer. Never execute tools. */
export function transcript(fixture: Fixture, step: number, mode: Verbosity, expanded: boolean, theme: Theme, tui: TUI): Component[] {
  const definitions = [createBashToolDefinition("/fixture"), createReadToolDefinition("/fixture"), createEditToolDefinition("/fixture"), createWriteToolDefinition("/fixture"), createGrepToolDefinition("/fixture"), createFindToolDefinition("/fixture"), createLsToolDefinition("/fixture"), createWebFetchTool(), createWebSearchTool()];
  const supported = new Set(definitions.map(tool => tool.name));
  const activity = new Activity(supported);
  const rows: Component[] = [];
  const tools = new Map<string, ToolExecutionComponent>();
  const events = fixture.events.slice(0, step);
  for (const event of events) {
    switch (event.type) {
      case "user":
        activity.boundary();
        rows.push(new UserMessageComponent(event.text));
        break;
      case "assistant":
        activity.boundary();
        rows.push(new AssistantMessageComponent(assistant(event.text)));
        break;
      case "boundary":
        activity.prompt();
        rows.push(new Text(theme.fg("muted", event.text), 1, 1));
        break;
      case "call": {
        activity.start(event.id, event.name, event.args);
        const definition = definitions.find(tool => tool.name === event.name);
        const native = new ToolExecutionComponent(event.name, event.id, event.args, { showImages: false }, definition, tui, "/fixture");
        // Do not mark arguments complete: edit can otherwise read live files for a preview.
        // Do not start execution clocks or their refresh timers during render-only replay.
        native.setExpanded(expanded);
        tools.set(event.id, native);
        if (mode === "default" || !definition) rows.push(native);
        else rows.push(activityComponent(activity, {
          name: event.name, theme, normal: native, showDetailsHint: false, standaloneSpacing: true,
          expandedNormal: { invalidate() { native.invalidate(); }, render(width) { native.setExpanded(true); return native.render(width); } },
          context: { toolCallId: event.id, args: event.args, state: {}, lastComponent: undefined, cwd: "/fixture", executionStarted: true, argsComplete: true, isPartial: true, expanded, showImages: false, isError: false, invalidate() {} },
        }, () => true));
        break;
      }
      case "result": {
        const result = { content: [{ type: "text", text: event.text }], isError: event.error };
        tools.get(event.id)?.updateResult(result);
        activity.finish(event.id, result);
        break;
      }
    }
  }
  return rows;
}

/** Render a component list without introducing spacers for collapsed sibling rows. */
export function renderRows(rows: readonly Component[], width: number): string[] {
  return rows.flatMap(row => row.render(width));
}
/** Compose ANSI-safe comparison columns at an exact terminal width. */
export function columns(left: readonly string[], right: readonly string[], width: number): string[] {
  const half = Math.max(1, Math.floor((width - 3) / 2));
  const rightWidth = Math.max(1, width - half - 3);
  return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
    const a = truncateToWidth(left[i] ?? "", half, "");
    return a + "\x1b[0m" + " ".repeat(Math.max(0, half - visibleWidth(a))) + " │ " + truncateToWidth(right[i] ?? "", rightWidth, "") + "\x1b[0m";
  });
}
