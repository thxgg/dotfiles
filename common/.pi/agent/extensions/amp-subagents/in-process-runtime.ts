import type { Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "./agents.ts";
import { getActiveToolNames, getDisallowedToolNames } from "./agents.ts";
import type { AgentJobSnapshot, RuntimeJob, ToolCallSummary, UsageStats } from "./job-types.ts";
import { emptyUsage, snapshotJob } from "./job-types.ts";
import { composeAgentPrompt } from "./prompt.ts";
import { createPermissionGuard } from "./readonly.ts";

function getMessageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n");
}

function addUsage(usage: UsageStats, message: any): void {
  const value = message?.usage;
  if (!value) return;
  usage.input += Number(value.input ?? 0);
  usage.output += Number(value.output ?? 0);
  usage.cacheRead += Number(value.cacheRead ?? 0);
  usage.cacheWrite += Number(value.cacheWrite ?? 0);
  usage.cost += Number(value.cost?.total ?? value.cost ?? 0);
  usage.contextTokens = Number(value.totalTokens ?? value.contextTokens ?? usage.contextTokens);
  usage.turns += 1;
}

function formatModel(model: Model<any> | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

function resolveModel(ctx: ExtensionContext, modelSpec: string | undefined): Model<any> | undefined {
  if (!modelSpec) return undefined;
  const slash = modelSpec.indexOf("/");
  if (slash === -1) return ctx.modelRegistry.find(ctx.model?.provider ?? "openai-codex", modelSpec);
  return ctx.modelRegistry.find(modelSpec.slice(0, slash), modelSpec.slice(slash + 1));
}

function createSettingsManager(cwd: string, agent: AgentDefinition): SettingsManager {
  const settings = SettingsManager.create(cwd, getAgentDir());
  if (agent.compaction) {
    settings.applyOverrides({ compaction: { ...agent.compaction } } as any);
  }
  return settings;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function collectPaths(name: string, args: Record<string, unknown>, read: Set<string>, changed: Set<string>): void {
  const value = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
  if (!value) return;
  if (name === "edit" || name === "write") changed.add(value);
  if (["read", "grep", "find", "ls"].includes(name)) read.add(value);
}

function collectArtifacts(result: unknown, artifacts: Set<string>): void {
  const images = asRecord(asRecord(result).details).images;
  if (!Array.isArray(images)) return;
  for (const image of images) {
    const value = asRecord(image).path;
    if (typeof value === "string") artifacts.add(value);
  }
}

function isValidationCommand(command: string): boolean {
  return /\b(test|tests|check|lint|typecheck|tsc|pytest|vitest|jest|cargo\s+test|go\s+test|npm\s+test|pnpm\s+test|bun\s+test)\b/i.test(command);
}

export async function runInProcessJob(
  job: RuntimeJob,
  agent: AgentDefinition,
  ctx: ExtensionContext,
  onUpdate?: (snapshot: AgentJobSnapshot) => void,
): Promise<AgentJobSnapshot> {
  const usage = emptyUsage();
  const toolCalls = new Map<string, ToolCallSummary>();
  const filesRead = new Set<string>();
  const filesChanged = new Set<string>();
  const validation = new Set<string>();
  const artifacts = new Set<string>();
  let finalSummary = "";
  let stopReason: string | undefined;
  let errorMessage: string | undefined;
  let maxTurnAbort = false;

  const emit = () => onUpdate?.(snapshotJob(job));
  const model = resolveModel(ctx, agent.model);
  if (agent.model && !model) throw new Error(`Model not found for subagent ${agent.name}: ${agent.model}`);
  job.model = formatModel(model ?? ctx.model);
  job.thinking = agent.thinking;
  job.status = "running";
  emit();

  const settingsManager = createSettingsManager(job.cwd, agent);
  const loader = new DefaultResourceLoader({
    cwd: job.cwd,
    agentDir: getAgentDir(),
    settingsManager,
    appendSystemPromptOverride: (base) => [...base, composeAgentPrompt(agent)],
    extensionFactories: [createPermissionGuard(agent)],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: job.cwd,
    agentDir: getAgentDir(),
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(job.cwd),
    model: model ?? ctx.model,
    modelRegistry: ctx.modelRegistry,
    thinkingLevel: agent.thinking,
    tools: getActiveToolNames(agent),
    excludeTools: getDisallowedToolNames(agent),
  });

  const abortChild = () => { void session.abort(); };
  job.controller.signal.addEventListener("abort", abortChild, { once: true });
  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "tool_execution_start") {
      const args = asRecord(event.args);
      const call: ToolCallSummary = { id: String(event.toolCallId ?? `${event.toolName}-${toolCalls.size + 1}`), name: String(event.toolName ?? "unknown"), args, status: "running" };
      toolCalls.set(call.id, call);
      collectPaths(call.name, args, filesRead, filesChanged);
      if (call.name === "bash" && typeof args.command === "string" && isValidationCommand(args.command)) validation.add(args.command);
      emit();
    }
    if (event.type === "tool_execution_end") {
      const call = toolCalls.get(String(event.toolCallId ?? ""));
      if (call) {
        call.status = event.isError ? "failed" : "completed";
        if (event.isError) call.error = getMessageText(event.result) || "tool failed";
      }
      collectArtifacts(event.result, artifacts);
      emit();
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const text = getMessageText(event.message).trim();
      if (text) finalSummary = text;
      addUsage(usage, event.message);
      if (event.message.stopReason) stopReason = event.message.stopReason;
      if (event.message.errorMessage) errorMessage = event.message.errorMessage;
      emit();
    }
    if (event.type === "turn_end" && agent.maxTurns && Number(event.turnIndex ?? 0) + 1 >= agent.maxTurns) {
      maxTurnAbort = true;
      void session.abort();
    }
  });

  try {
    await session.prompt(`Task: ${job.task}`);
    if (maxTurnAbort) throw new Error(`Subagent ${agent.name} stopped after reaching maxTurns=${agent.maxTurns}.`);
    if (errorMessage || stopReason === "error") throw new Error(errorMessage || `Subagent stopped with reason: ${stopReason}`);
    job.status = "completed";
    job.result = {
      summary: finalSummary || "(no output)", filesRead: Array.from(filesRead).sort(), filesChanged: Array.from(filesChanged).sort(),
      validation: Array.from(validation), artifacts: Array.from(artifacts).sort(), usage,
      toolCalls: Array.from(toolCalls.values()), stopReason, errorMessage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.status = job.controller.signal.aborted || maxTurnAbort || /aborted/i.test(message) ? "cancelled" : "failed";
    job.error = message;
    job.result = {
      summary: finalSummary || message, filesRead: Array.from(filesRead).sort(), filesChanged: Array.from(filesChanged).sort(),
      validation: Array.from(validation), artifacts: Array.from(artifacts).sort(), usage,
      toolCalls: Array.from(toolCalls.values()), stopReason, errorMessage: message,
    };
  } finally {
    job.controller.signal.removeEventListener("abort", abortChild);
    unsubscribe();
    session.dispose();
    job.endedAt = new Date().toISOString();
    emit();
  }
  return snapshotJob(job);
}
