import {
  createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition,
  createReadToolDefinition, createLsToolDefinition, createGrepToolDefinition, createFindToolDefinition,
  getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { withFocusRendering } from "./adapter.ts";

/** Explicit standard-local opt-in only: SDK base overrides can report builtin provenance. */
export function registerLocalTools(pi: ExtensionAPI): string[] {
  const settings = (ctx: ExtensionContext) => SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
  const cwd = process.cwd();
  const read = createReadToolDefinition(cwd);
  const bash = createBashToolDefinition(cwd);
  const definitions = [
    { ...read, execute(id, args, signal, onUpdate, ctx) {
      return createReadToolDefinition(ctx.cwd, { autoResizeImages: settings(ctx).getImageAutoResize() }).execute(id, args, signal, onUpdate, ctx);
    } } satisfies typeof read,
    { ...bash, execute(id, args, signal, onUpdate, ctx) {
      const current = settings(ctx);
      return createBashToolDefinition(ctx.cwd, {
        shellPath: current.getShellPath(), commandPrefix: current.getShellCommandPrefix(),
      }).execute(id, args, signal, onUpdate, ctx);
    } } satisfies typeof bash,
  ] as const;
  pi.registerTool(withFocusRendering(pi, definitions[0]!));
  pi.registerTool(withFocusRendering(pi, definitions[1]!));
  pi.registerTool(withFocusRendering(pi, createEditToolDefinition(cwd)));
  pi.registerTool(withFocusRendering(pi, createWriteToolDefinition(cwd)));
  pi.registerTool(withFocusRendering(pi, createLsToolDefinition(cwd)));
  pi.registerTool(withFocusRendering(pi, createGrepToolDefinition(cwd)));
  pi.registerTool(withFocusRendering(pi, createFindToolDefinition(cwd)));
  return ["read", "bash", "edit", "write", "ls", "grep", "find"];
}
