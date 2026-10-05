import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, type Component } from "@earendil-works/pi-tui";

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;
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
}
/** Wrap only Pi's resolved presentation. No executable tool definition crosses this boundary. */
export function withVerbosityRenderers(
  name: string,
  tool: ToolRenderers,
  decorate: (request: RenderRequest) => Component,
): ToolRenderers {
  const rows = new WeakMap<object, { call?: Component; result?: Component; consumed?: Component; expandResult?: (expanded: boolean) => void }>();
  const row = (state: object) => {
    let value = rows.get(state);
    if (!value) { value = {}; rows.set(state, value); }
    return value;
  };
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      const current = row(context.state);
      const renderCall = (expanded = context.expanded) => {
        try { return tool.renderCall?.(args, theme, { ...context, expanded, lastComponent: current.call }) ?? new Text(name, 0, 0); }
        catch { return new Text(theme.fg("toolTitle", name), 0, 0); }
      };
      current.call = renderCall();
      let outputExpanded = context.expanded;
      let nativeContainer: Component | undefined;
      const normal: Component = {
        invalidate() { current.call?.invalidate(); current.result?.invalidate(); },
        handleMouse(event) {
          const handled = nativeContainer?.handleMouse?.(event);
          if (handled?.handled) return handled;
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
          nativeContainer = box;
          return box.render(width);
        },
      };
      let expanded = false;
      const expandedNormal: Component = {
        invalidate() { expanded = false; normal.invalidate(); },
        render(width) {
          if (!expanded) {
            current.call = renderCall(true);
            current.expandResult?.(true);
            expanded = true;
          }
          return normal.render(width);
        },
      };
      const request: RenderRequest = { name, context, theme, normal, expandedNormal };
      const component = decorate(request);
      return {
        invalidate() { component.invalidate(); normal.invalidate(); expandedNormal.invalidate(); },
        handleMouse(event) { return component.handleMouse?.(event); },
        render(width) {
          const lines = component.render(width);
          // The TUI renders both slots together, including intentionally hidden groups.
          // HTML export renders them separately. Do not lose its result slot.
          current.consumed = current.result;
          return lines;
        },
      };
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
      current.consumed = undefined;
      current.expandResult = expanded => { current.result = renderResult(expanded); };
      return {
        invalidate() { current.result?.invalidate(); },
        render(width) {
          return current.result && current.consumed !== current.result ? current.result.render(width) : [];
        },
      };
    },
  };
}
