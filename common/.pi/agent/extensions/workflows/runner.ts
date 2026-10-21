import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runChildTask, isRecord, messageText } from "../subagents/runtime.ts";
import { emptyUsage, type TranscriptEntry, type WorkflowUsage } from "./model.ts";

export interface WorkflowAgentOutcome {
  ok: boolean;
  output: string;
  structured?: unknown;
  error?: string;
  usage: WorkflowUsage;
  model?: string;
  transcript: TranscriptEntry[];
  sessionFile?: string;
  sessionId?: string;
}
export const WORKFLOW_MODELS = ["openai/gpt-6-astra", "anthropic/claude-fable-5"] as const;
export function resolveWorkflowModel(ctx: Pick<ExtensionContext, "modelRegistry">, spec: unknown): Model<any> | undefined {
  const requested = typeof spec === "string" && spec.trim() ? spec.trim() : WORKFLOW_MODELS[0];
  const normalized = requested === "gpt-6-astra" ? WORKFLOW_MODELS[0] : requested === "fable-5" || requested === "claude-fable-5" ? WORKFLOW_MODELS[1] : requested;
  if (!(WORKFLOW_MODELS as readonly string[]).includes(normalized)) return undefined;
  const slash = normalized.indexOf("/");
  return ctx.modelRegistry.find(normalized.slice(0, slash), normalized.slice(slash + 1));
}
export async function runWorkflowAgent(options: {
  prompt: string; schema?: unknown; model?: unknown; effort?: unknown;
  cwd: string; projectTrusted: boolean; ctx: ExtensionContext; signal: AbortSignal;
  onProgress?(outcome: Partial<WorkflowAgentOutcome>): void;
}): Promise<WorkflowAgentOutcome> {
  const model = resolveWorkflowModel(options.ctx, options.model);
  if (!model) return { ok: false, output: "", error: `Unsupported workflow model: ${String(options.model)}. Use gpt-6-astra or fable-5.`, usage: emptyUsage(), transcript: [] };
  const thinking = typeof options.effort === "string" ? options.effort : options.ctx.thinkingLevel ?? "medium";
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking)) return { ok: false, output: "", error: `Invalid thinking level: ${thinking}`, usage: emptyUsage(), transcript: [] };
  const result = await runChildTask({ prompt: options.prompt, schema: options.schema, cwd: options.cwd,
    provider: model.provider, model: model.id, thinking, signal: options.signal, projectTrusted: options.projectTrusted,
    parentSessionId: options.ctx.sessionManager.getSessionId(), parentSessionFile: options.ctx.sessionManager.getSessionFile(),
    onProgress(message) { options.onProgress?.({ output: messageText(message), model: `${model.provider}/${model.id}` }); },
  });
  const usage = emptyUsage();
  const transcript: TranscriptEntry[] = [];
  for (const message of result.messages.filter(isRecord)) {
    if (message.role === "assistant") {
      usage.turns++;
      if (isRecord(message.usage)) {
        for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) usage[key] += Number(message.usage[key] ?? 0);
        if (isRecord(message.usage.cost)) usage.cost += Number(message.usage.cost.total ?? 0);
      }
    }
    const timestamp = typeof message.timestamp === "number" ? message.timestamp : undefined;
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content.filter(isRecord)) {
        if (part.type === "text" && typeof part.text === "string") transcript.push({ role: "assistant", text: part.text.slice(0, 16384), timestamp });
        if (part.type === "thinking" && typeof part.thinking === "string") transcript.push({ role: "thinking", text: part.thinking.slice(0, 16384), timestamp });
        if (part.type === "toolCall" && typeof part.name === "string") transcript.push({ role: "tool", name: part.name, text: (JSON.stringify(part.arguments) ?? "").slice(0, 16384), timestamp });
      }
    } else if (message.role === "user" || message.role === "toolResult") {
      transcript.push({ role: message.role, text: messageText(message).slice(0, 16384), timestamp,
        ...(typeof message.toolName === "string" ? { name: message.toolName } : {}),
        ...(typeof message.isError === "boolean" ? { isError: message.isError } : {}) });
    }
  }
  const { messages: _messages, ...outcome } = result;
  return { ...outcome, usage, transcript: transcript.slice(-200), model: `${model.provider}/${model.id}` };
}
