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
  const rows = new WeakMap<object, { call?: Component; result?: Component }>();
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
      current.call = tool.renderCall?.(args, theme, { ...context, lastComponent: current.call }) ?? new Text(tool.name, 0, 0);
      const normal: Component = {
        invalidate() {},
        render(width) {
          const box = tool.renderShell === "self" ? new Container() : new Box(1, 1, text => theme.bg(
            context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg", text,
          ));
          if (current.call) box.addChild(current.call);
          if (current.result) box.addChild(current.result);
          return box.render(width);
        },
      };
      const request: RenderRequest = { name: tool.name, context, theme, normal };
      pi.events.emit(RENDER_EVENT, request);
      return request.component ?? normal;
    },
    renderResult(result, options, theme, context) {
      const current = row(context.state);
      current.result = tool.renderResult?.(result, options, theme, { ...context, lastComponent: current.result })
        ?? new Text(result.content.filter(p => p.type === "text").map(p => p.text).join("\n"), 0, 0);
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
