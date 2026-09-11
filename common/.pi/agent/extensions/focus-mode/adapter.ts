import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, type Component } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

type RenderCall = NonNullable<ToolDefinition["renderCall"]>;
export type RenderContext = Parameters<RenderCall>[2];
export type RenderTheme = Parameters<RenderCall>[1];
export interface RenderRequest {
  name: string;
  context: RenderContext;
  theme: RenderTheme;
  normal: Component;
  expandedNormal?: Component;
  /** False for viewers that do not register the archived details command. */
  showDetailsHint?: boolean;
  /** Add Pi's outer row spacer when rendering outside ToolExecutionComponent. */
  standaloneSpacing?: boolean;
  component?: Component;
}
export const RENDER_EVENT = "dotfiles:focus:render:v1";
export const DISCOVER_EVENT = "dotfiles:focus:discover:v1";
export interface Discovery { names: Set<string> }

/** Explicit opt-in. Only rendering changes; execute and all metadata keep their identity. */
export function withFocusRendering<P extends TSchema, D>(
  pi: Pick<ExtensionAPI, "events">,
  tool: ToolDefinition<P, D>,
): ToolDefinition<P, D> {
  const rows = new WeakMap<object, { call?: Component; result?: Component; expandResult?: (expanded: boolean) => void }>();
  const row = (state: object) => {
    let value = rows.get(state);
    if (!value) { value = {}; rows.set(state, value); }
    return value;
  };
  return {
    ...tool,
    renderShell: "self",
    renderCall(args, theme, context) {
      const current = row(context.state);
      const renderCall = (expanded = context.expanded) => {
        try { return tool.renderCall?.(args, theme, { ...context, expanded, lastComponent: current.call }) ?? new Text(tool.name, 0, 0); }
        catch { return new Text(theme.fg("toolTitle", tool.name), 0, 0); }
      };
      current.call = renderCall();
      let outputExpanded = context.expanded;
      const normal: Component = {
        invalidate() {},
        handleMouse(event) {
          if (event.type !== "click" || event.button !== "left") return;
          outputExpanded = !outputExpanded;
          current.call = renderCall(outputExpanded);
          current.expandResult?.(outputExpanded);
          context.invalidate();
          return { handled: true };
        },
        render(width) {
          const box = tool.renderShell === "self" ? new Container() : new Box(1, 1, text => theme.bg(
            context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg", text,
          ));
          if (current.call) box.addChild(current.call);
          if (current.result) box.addChild(current.result);
          return box.render(width);
        },
      };
      let expanded = false;
      const expandedNormal: Component = {
        invalidate() { expanded = false; },
        render(width) {
          if (!expanded) {
            current.call = renderCall(true);
            current.expandResult?.(true);
            expanded = true;
          }
          return normal.render(width);
        },
      };
      const request: RenderRequest = { name: tool.name, context, theme, normal, expandedNormal };
      pi.events.emit(RENDER_EVENT, request);
      return request.component ?? normal;
    },
    renderResult(result, options, theme, context) {
      const current = row(context.state);
      const renderResult = (expanded = options.expanded) => {
        try {
          if (tool.renderResult) return tool.renderResult(result, { ...options, expanded }, theme, { ...context, expanded, lastComponent: current.result });
        } catch { /* Keep the result visible if the owning renderer fails. */ }
        return new Text(result.content.filter(p => p.type === "text").map(p => p.text).join("\n"), 0, 0);
      };
      current.result = renderResult();
      current.expandResult = expanded => { current.result = renderResult(expanded); };
      // Both native slots live in the call component so normal mode has one unchanged box.
      return new Container();
    },
  };
}

/** Register once in an owning extension, and dispose on shutdown. */
export function announceFocusTools(pi: Pick<ExtensionAPI, "events" | "getAllTools">, names: readonly string[], ownerUrl: string): () => void {
  return pi.events.on(DISCOVER_EVENT, (value: unknown) => {
    const request = value as Discovery;
    if (!(request?.names instanceof Set)) return;
    for (const tool of pi.getAllTools()) {
      if (!names.includes(tool.name)) continue;
      try {
        if (realpathSync(tool.sourceInfo.path) === realpathSync(fileURLToPath(ownerUrl))) request.names.add(tool.name);
      } catch { /* Unknown ownership: keep normal rendering. */ }
    }
  });
}
