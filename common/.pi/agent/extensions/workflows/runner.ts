import type { Model } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager,
  type AgentSessionEvent, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../subagents/agents.ts";
import { getActiveToolNames, getDisallowedToolNames } from "../subagents/agents.ts";
import { bindChildSessionExtensions, shutdownAndDisposeChildSession } from "../subagents/child-lifecycle.ts";
import { createPermissionGuard } from "../subagents/readonly.ts";
import { createStructuredOutputTool, STRUCTURED_OUTPUT_INSTRUCTION } from "../subagents/structured-output.ts";
import { createToolTimeoutGuard } from "../subagents/tool-timeout.ts";
import { emptyUsage, type TranscriptEntry, type WorkflowUsage } from "./model.ts";

export interface WorkflowAgentOutcome {
  ok: boolean;
  output: string;
  structured?: unknown;
  error?: string;
  usage: WorkflowUsage;
  model?: string;
  transcript: TranscriptEntry[];
}
function text(message: any): string {
  return Array.isArray(message?.content) ? message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n") : typeof message?.content === "string" ? message.content : "";
}
function usage(messages: any[]): WorkflowUsage {
  const total = emptyUsage();
  for (const message of messages) if (message.role === "assistant") {
    total.turns += 1; total.input += Number(message.usage?.input ?? 0); total.output += Number(message.usage?.output ?? 0);
    total.cacheRead += Number(message.usage?.cacheRead ?? 0); total.cacheWrite += Number(message.usage?.cacheWrite ?? 0); total.cost += Number(message.usage?.cost?.total ?? 0);
  }
  return total;
}
function transcript(messages: any[]): TranscriptEntry[] {
  const values: TranscriptEntry[] = [];
  for (const message of messages) {
    if (message.role === "user") values.push({ role: "user", text: typeof message.content === "string" ? message.content : text(message), timestamp: message.timestamp });
    if (message.role === "assistant") for (const part of message.content ?? []) {
      if (part.type === "text" && part.text?.trim()) values.push({ role: "assistant", text: part.text, timestamp: message.timestamp });
      if (part.type === "thinking" && part.thinking?.trim()) values.push({ role: "thinking", text: part.thinking, timestamp: message.timestamp });
      if (part.type === "toolCall") values.push({ role: "tool", name: part.name, text: JSON.stringify(part.arguments), timestamp: message.timestamp });
    }
    if (message.role === "toolResult") values.push({ role: "toolResult", name: message.toolName, text: text(message), isError: message.isError, timestamp: message.timestamp });
  }
  return values.slice(-200).map((entry) => ({ ...entry, text: entry.text.slice(0, 16 * 1024) }));
}
export const WORKFLOW_MODELS = ["openai-codex/gpt-5.6-sol", "anthropic/claude-fable-5"] as const;
const DEFAULT_WORKFLOW_MODEL = WORKFLOW_MODELS[0];
export function resolveWorkflowModel(ctx: Pick<ExtensionContext, "modelRegistry">, spec: unknown): Model<any> | undefined {
  const requested = typeof spec === "string" && spec.trim() ? spec.trim() : DEFAULT_WORKFLOW_MODEL;
  const normalized = requested === "gpt-5.6-sol" ? DEFAULT_WORKFLOW_MODEL : requested === "fable-5" || requested === "claude-fable-5" ? WORKFLOW_MODELS[1] : requested;
  if (!(WORKFLOW_MODELS as readonly string[]).includes(normalized)) return undefined;
  const slash = normalized.indexOf("/");
  return ctx.modelRegistry.find(normalized.slice(0, slash), normalized.slice(slash + 1));
}
function defaultWorkflowAgent(ctx: ExtensionContext): AgentDefinition {
  return {
    name: "workflow-worker", description: "Ephemeral workflow child", permissions: {}, background: false, hidden: true,
    systemPrompt: "Complete the assigned workflow unit. Do not delegate. Return a concise, evidence-backed result.", source: "builtin", filePath: "<workflow>",
  };
}
export async function runWorkflowAgent(options: {
  prompt: string; schema?: unknown; model?: unknown; effort?: unknown;
  cwd: string; projectTrusted: boolean; ctx: ExtensionContext; signal: AbortSignal;
  onProgress?(outcome: Partial<WorkflowAgentOutcome>): void;
}): Promise<WorkflowAgentOutcome> {
  const definition = defaultWorkflowAgent(options.ctx);
  let structured: unknown;
  const settings = SettingsManager.create(options.cwd, getAgentDir(), { projectTrusted: options.projectTrusted });
  const loader = new DefaultResourceLoader({
    cwd: options.cwd, agentDir: getAgentDir(), settingsManager: settings,
    appendSystemPromptOverride: (base) => [...base, definition.systemPrompt, ...(options.schema ? [STRUCTURED_OUTPUT_INSTRUCTION] : [])],
    extensionFactories: [createPermissionGuard(definition)],
  });
  await loader.reload();
  const model = resolveWorkflowModel(options.ctx, options.model);
  if (!model) return { ok: false, output: "", error: `Unsupported workflow model: ${String(options.model)}. Use gpt-5.6-sol or fable-5.`, usage: emptyUsage(), transcript: [] };
  const { session } = await createAgentSession({
    cwd: options.cwd, model, modelRegistry: options.ctx.modelRegistry, resourceLoader: loader, settingsManager: settings,
    sessionManager: SessionManager.inMemory(options.cwd), thinkingLevel: (typeof options.effort === "string" ? options.effort : definition.thinking) as any,
    tools: getActiveToolNames(definition, Boolean(options.schema)), excludeTools: [...new Set([...getDisallowedToolNames(definition), "Agent", "workflow", "ask_user"])],
    ...(options.schema ? { customTools: [createStructuredOutputTool(options.schema, (value) => { structured = value; })] } : {}),
  });
  await bindChildSessionExtensions(session);
  const timeoutGuard = createToolTimeoutGuard(); timeoutGuard.apply(session);
  let firstResponseTimer: ReturnType<typeof setTimeout> | undefined;
  let stopReason: string | undefined; let errorMessage: string | undefined; let maxTurnAbort = false; let turnCount = 0;
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "agent_start") timeoutGuard.apply(session);
    if ((event.type === "message_start" || event.type === "message_update" || event.type === "message_end") && event.message.role === "assistant") {
      if (firstResponseTimer) clearTimeout(firstResponseTimer); firstResponseTimer = undefined;
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      stopReason = event.message.stopReason; errorMessage = event.message.errorMessage;
      options.onProgress?.({ output: text(event.message), usage: usage(session.messages), model: session.model?.id, transcript: transcript(session.messages) });
    }
    if (event.type === "turn_end" && definition.maxTurns && ++turnCount >= definition.maxTurns) {
      maxTurnAbort = true;
      void session.abort();
    }
  });
  const abort = () => { void session.abort(); };
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    const stalled = new Promise<never>((_resolve, reject) => { firstResponseTimer = setTimeout(() => { void session.abort(); reject(new Error("Workflow child produced no assistant response event within 45 seconds.")); }, 45_000); firstResponseTimer.unref?.(); });
    await Promise.race([session.prompt(options.prompt), stalled]);
    const output = [...session.messages].reverse().find((message) => message.role === "assistant" && text(message).trim());
    if (options.schema && structured === undefined) throw new Error("Workflow child did not produce required structured output.");
    if (maxTurnAbort) throw new Error(`Workflow child ${definition.name} stopped after reaching maxTurns=${definition.maxTurns}.`);
    if (stopReason === "error" || errorMessage) throw new Error(errorMessage ?? "Workflow child failed.");
    return { ok: true, output: output ? text(output).slice(0, 64 * 1024) : "", structured, usage: usage(session.messages), model: session.model?.id, transcript: transcript(session.messages) };
  } catch (error) {
    return { ok: false, output: "", structured, error: options.signal.aborted ? "Workflow child was cancelled." : error instanceof Error ? error.message : String(error), usage: usage(session.messages), model: session.model?.id, transcript: transcript(session.messages) };
  } finally {
    if (firstResponseTimer) clearTimeout(firstResponseTimer);
    options.signal.removeEventListener("abort", abort); unsubscribe(); await shutdownAndDisposeChildSession(session);
  }
}
