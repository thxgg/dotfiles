import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, getApiProvider, type Model, type SimpleStreamOptions, type StreamOptions } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream, Context } from "@earendil-works/pi-ai";

type PiModel = NonNullable<ExtensionContext["model"]>;
type JsonRecord = Record<string, unknown>;
type CodexProvider = NonNullable<ReturnType<typeof getApiProvider>>;

const PROVIDER = "openai-codex";
const CODEX_API = "openai-codex-responses";
const BASE_MODEL = "gpt-5.5";
const FAST_MODEL = "gpt-5.5-fast";
const ONE_MILLION_MODEL = "gpt-5.5-1m";
const STATUS_KEY = "gpt55-fast";
const FAST_SERVICE_TIER = "priority";
const DEFAULT_FAST_ENABLED_FOR_BASE_MODEL = true;
const BASE_COST = {
  input: 5,
  output: 30,
  cacheRead: 0.5,
  cacheWrite: 0,
};
const PROVIDER_PROBE_JWT =
  "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdF9waV9leHRlbnNpb25fcHJvYmUifX0.sig";

let fastEnabledForBaseModel = DEFAULT_FAST_ENABLED_FOR_BASE_MODEL;
let warnedOneMillionThresholdCompaction = false;

function isBaseGpt55(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === BASE_MODEL;
}

function isFastGpt55(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === FAST_MODEL;
}

function isOneMillionGpt55(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === ONE_MILLION_MODEL;
}

function isToggleableGpt55(model: PiModel | undefined): boolean {
  return isBaseGpt55(model) || isOneMillionGpt55(model);
}

function isSupportedModel(model: PiModel | undefined): boolean {
  return isToggleableGpt55(model) || isFastGpt55(model);
}

function isFastActive(model: PiModel | undefined): boolean {
  return isFastGpt55(model) || (isToggleableGpt55(model) && fastEnabledForBaseModel);
}

function upstreamModelId(model: Model): string {
  if (isFastGpt55(model) || isOneMillionGpt55(model)) return BASE_MODEL;
  return model.id;
}

function serviceTierForModel(model: Model): string | undefined {
  return isFastGpt55(model) || (isToggleableGpt55(model) && fastEnabledForBaseModel) ? FAST_SERVICE_TIER : undefined;
}

function toUpstreamCodexModel(model: Model): Model {
  if (!isFastGpt55(model) && !isOneMillionGpt55(model)) return model;

  return {
    ...model,
    id: BASE_MODEL,
    cost: BASE_COST,
  };
}

function formatModel(model: PiModel | undefined): string {
  return model ? `${model.provider}/${model.id}` : "none";
}

function updateStatus(ctx: ExtensionContext, model: PiModel | undefined = ctx.model): void {
  if (isFastActive(model)) {
    ctx.ui.setStatus(STATUS_KEY, "GPT-5.5 Fast");
  } else if (isOneMillionGpt55(model)) {
    ctx.ui.setStatus(STATUS_KEY, "GPT-5.5 1M");
  } else {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function rewriteCodexAliasPayload(payload: unknown, model: Model, serviceTier: string | undefined): unknown {
  const body = asRecord(payload);
  if (!body) return payload;

  const upstream = upstreamModelId(model);
  const shouldRewriteModel = typeof body.model === "string" && body.model !== upstream;
  if (!shouldRewriteModel && !serviceTier) return payload;

  return {
    ...body,
    ...(shouldRewriteModel ? { model: upstream } : {}),
    ...(serviceTier ? { service_tier: serviceTier } : {}),
  };
}

function normalizeCodexAliasAssistantMessage(message: unknown, currentModel: PiModel | undefined): void {
  const assistant = asRecord(message);
  if (!assistant || assistant.role !== "assistant") return;
  if (assistant.provider !== PROVIDER || assistant.model !== BASE_MODEL) return;
  if (!isFastGpt55(currentModel) && !isOneMillionGpt55(currentModel)) return;

  assistant.model = currentModel.id;
}

function resolveRequestedState(args: string, current: boolean): boolean | undefined {
  const normalized = args.trim().toLowerCase();
  if (!normalized || normalized === "toggle") return !current;
  if (["on", "enable", "enabled", "true", "1", "yes"].includes(normalized)) return true;
  if (["off", "disable", "disabled", "false", "0", "no"].includes(normalized)) return false;
  if (["status", "state"].includes(normalized)) return current;
  return undefined;
}

type CodexOptions = StreamOptions & {
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null;
  serviceTier?: string;
  textVerbosity?: "low" | "medium" | "high";
};

function createCodexOptions(model: Model, options?: SimpleStreamOptions): CodexOptions {
  const codexOptions = options as CodexOptions | undefined;
  const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
  const reasoningEffort = clampedReasoning === "off" ? undefined : (clampedReasoning ?? codexOptions?.reasoningEffort);
  const serviceTier = serviceTierForModel(model) ?? codexOptions?.serviceTier;
  const originalOnPayload = options?.onPayload;

  return {
    ...codexOptions,
    reasoningEffort,
    serviceTier,
    async onPayload(payload, requestModel) {
      let current = rewriteCodexAliasPayload(payload, model, serviceTier);
      const next = await originalOnPayload?.(current, requestModel);
      if (next !== undefined) current = next;
      return rewriteCodexAliasPayload(current, model, serviceTier);
    },
  };
}

function probeModel(): Model {
  return {
    id: BASE_MODEL,
    name: "GPT-5.5",
    api: CODEX_API,
    provider: PROVIDER,
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: BASE_COST,
    contextWindow: 272000,
    maxTokens: 128000,
  };
}

async function drain(stream: AssistantMessageEventStream): Promise<void> {
  for await (const _event of stream) {
    // Drain the probe stream so lazy provider registration finishes.
  }
}

async function loadCodexProvider(): Promise<CodexProvider> {
  const lazyProvider = getApiProvider(CODEX_API);
  if (!lazyProvider) throw new Error(`Could not find built-in ${CODEX_API} provider to wrap.`);

  const controller = new AbortController();
  controller.abort();

  await drain(
    lazyProvider.stream(probeModel(), { systemPrompt: "", messages: [] } satisfies Context, {
      apiKey: PROVIDER_PROBE_JWT,
      signal: controller.signal,
      transport: "sse",
      maxRetries: 0,
    }),
  ).catch(() => undefined);

  return getApiProvider(CODEX_API) ?? lazyProvider;
}

export default async function (pi: ExtensionAPI) {
  const codexProvider = await loadCodexProvider();

  pi.registerProvider(PROVIDER, {
    api: CODEX_API,
    streamSimple: (model, context, options) =>
      codexProvider.stream(toUpstreamCodexModel(model), context, createCodexOptions(model, options)),
  });

  pi.registerCommand("fast", {
    description: "Toggle GPT-5.5 Fast mode for openai-codex/gpt-5.5 aliases",
    getArgumentCompletions: (prefix: string) => {
      const options = ["on", "off", "toggle", "status"];
      const normalized = prefix.trim().toLowerCase();
      const filtered = options
        .filter((value) => value.startsWith(normalized))
        .map((value) => ({ value, label: value }));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx) => {
      if (!isSupportedModel(ctx.model)) {
        fastEnabledForBaseModel = DEFAULT_FAST_ENABLED_FOR_BASE_MODEL;
        updateStatus(ctx);
        ctx.ui.notify(`/fast is only available for ${PROVIDER}/${BASE_MODEL} aliases. Current model: ${formatModel(ctx.model)}`, "warning");
        return;
      }

      const current = isFastActive(ctx.model);
      const requested = resolveRequestedState(args, current);
      if (requested === undefined) {
        ctx.ui.notify("Usage: /fast [on|off|toggle|status]", "warning");
        return;
      }

      if (args.trim().toLowerCase() === "status") {
        updateStatus(ctx);
        ctx.ui.notify(`GPT-5.5 Fast mode is ${current ? "on" : "off"}.`, "info");
        return;
      }

      if (requested) {
        if (current) {
          updateStatus(ctx);
          ctx.ui.notify("GPT-5.5 Fast mode is already on.", "info");
          return;
        }

        fastEnabledForBaseModel = true;
        ctx.ui.setStatus(STATUS_KEY, "GPT-5.5 Fast");
        ctx.ui.notify("GPT-5.5 Fast mode enabled for this session.", "info");
        return;
      }

      if (isFastGpt55(ctx.model)) {
        const baseModel = ctx.modelRegistry.find(PROVIDER, BASE_MODEL);
        if (!baseModel) {
          ctx.ui.notify(`Could not find ${PROVIDER}/${BASE_MODEL}; staying on Fast model.`, "error");
          updateStatus(ctx);
          return;
        }

        const switched = await pi.setModel(baseModel);
        if (!switched) {
          ctx.ui.notify(`Could not switch to ${PROVIDER}/${BASE_MODEL}; staying on Fast model.`, "error");
          updateStatus(ctx);
          return;
        }
      }

      fastEnabledForBaseModel = false;
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.notify("GPT-5.5 Fast mode disabled.", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!isSupportedModel(ctx.model)) fastEnabledForBaseModel = DEFAULT_FAST_ENABLED_FOR_BASE_MODEL;
    updateStatus(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    if (!isToggleableGpt55(event.model)) fastEnabledForBaseModel = DEFAULT_FAST_ENABLED_FOR_BASE_MODEL;
    warnedOneMillionThresholdCompaction = false;
    updateStatus(ctx, event.model);
  });

  pi.on("message_end", async (event, ctx) => {
    normalizeCodexAliasAssistantMessage(event.message, ctx.model);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!isOneMillionGpt55(ctx.model) || event.reason !== "threshold") return;

    if (!warnedOneMillionThresholdCompaction) {
      ctx.ui.notify(
        "Skipping threshold auto-compaction for openai-codex/gpt-5.5-1m; preserving full 1M context until provider overflow or manual /compact.",
        "info",
      );
      warnedOneMillionThresholdCompaction = true;
    }

    return { cancel: true };
  });

  pi.on("before_provider_request", (event, ctx) => {
    const payloadModel = asRecord(event.payload)?.model;
    const aliasModel = typeof payloadModel === "string" ? ({ ...ctx.model, id: payloadModel } as Model) : ctx.model;
    const serviceTier = isFastActive(ctx.model) || payloadModel === FAST_MODEL ? FAST_SERVICE_TIER : undefined;
    return rewriteCodexAliasPayload(event.payload, aliasModel, serviceTier);
  });
}
