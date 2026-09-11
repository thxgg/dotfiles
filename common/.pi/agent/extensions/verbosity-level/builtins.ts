import {
  createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition,
  createReadToolDefinition, createLsToolDefinition, createGrepToolDefinition, createFindToolDefinition,
  getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { withVerbosityRendering } from "./adapter.ts";

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
  pi.registerTool(withVerbosityRendering(pi, definitions[0]!));
  pi.registerTool(withVerbosityRendering(pi, definitions[1]!));
  pi.registerTool(withVerbosityRendering(pi, createEditToolDefinition(cwd)));
  pi.registerTool(withVerbosityRendering(pi, createWriteToolDefinition(cwd)));
  pi.registerTool(withVerbosityRendering(pi, createLsToolDefinition(cwd)));
  pi.registerTool(withVerbosityRendering(pi, createGrepToolDefinition(cwd)));
  pi.registerTool(withVerbosityRendering(pi, createFindToolDefinition(cwd)));
  return ["read", "bash", "edit", "write", "ls", "grep", "find"];
}
