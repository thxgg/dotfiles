import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessageEventStream, Context, Model, SimpleStreamOptions, StreamOptions } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";

type PiModel = NonNullable<ExtensionContext["model"]>;
type JsonRecord = Record<string, unknown>;
type CodexProvider = NonNullable<ReturnType<typeof getApiProvider>>;

const PROVIDER = "openai-codex";
const CODEX_API = "openai-codex-responses";
const OPENAI_PROVIDER = "openai";
const OPENAI_API = "openai-responses";
const UPSTREAM_MODEL = "gpt-5.6-sol";
const ONE_MILLION_MODEL = "gpt-5.6-sol-1m";
const FAST_MODEL = "gpt-5.6-sol-fast";
const ASTRA_MODEL = "gpt-6-astra";
const ASTRA_FAST_MODEL = "gpt-6-astra-fast";
type Alias = typeof ONE_MILLION_MODEL | typeof FAST_MODEL | typeof ASTRA_FAST_MODEL;
const FAST_SERVICE_TIER = "priority";
const UPSTREAM_COST = {
  input: 5,
  output: 30,
  cacheRead: 0.5,
  cacheWrite: 0,
};
const OPENAI_COST = {
  input: 5,
  output: 30,
  cacheRead: 0.5,
  cacheWrite: 6.25,
};
const PROVIDER_PROBE_JWT =
  "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdF9waV9leHRlbnNpb25fcHJvYmUifX0.sig";

let warnedThresholdCompaction = false;

function isOneMillionSol(model: PiModel | undefined): boolean {
  return model?.provider === OPENAI_PROVIDER && model.id === ONE_MILLION_MODEL;
}

function selectedAlias(model: PiModel | undefined): Alias | undefined {
  if (isOneMillionSol(model)) return ONE_MILLION_MODEL;
  if (model?.provider === PROVIDER && (model.id === FAST_MODEL || model.id === ASTRA_FAST_MODEL)) return model.id;
  return undefined;
}

function isFastAlias(alias: Alias | undefined): boolean {
  return alias === FAST_MODEL || alias === ASTRA_FAST_MODEL;
}

function upstreamModelId(alias: Alias): string {
  return alias === ASTRA_FAST_MODEL ? ASTRA_MODEL : UPSTREAM_MODEL;
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function toUpstreamModel(model: Model<any>): Model<any> {
  const alias = selectedAlias(model);
  if (!alias) return model;

  return {
    ...model,
    id: upstreamModelId(alias),
    cost: alias === ASTRA_FAST_MODEL ? model.cost : alias === FAST_MODEL ? UPSTREAM_COST : OPENAI_COST,
  };
}

function rewriteAliasPayload(payload: unknown, alias: Alias | undefined): unknown {
  const body = asRecord(payload);
  if (!body || !alias) return payload;

  return {
    ...body,
    model: upstreamModelId(alias),
    ...(isFastAlias(alias) ? { service_tier: FAST_SERVICE_TIER } : {}),
  };
}

type CodexOptions = StreamOptions & {
  serviceTier?: string;
  reasoningEffort?: SimpleStreamOptions["reasoning"];
};

function createCodexOptions(model: Model<any>, options?: SimpleStreamOptions): CodexOptions {
  const alias = selectedAlias(model);
  const codexOptions = options as CodexOptions | undefined;
  const serviceTier = isFastAlias(alias) ? FAST_SERVICE_TIER : codexOptions?.serviceTier;
  const originalOnPayload = options?.onPayload;

  return {
    ...codexOptions,
    serviceTier,
    // The raw stream API uses reasoningEffort, not SimpleStreamOptions.reasoning.
    reasoningEffort: options?.reasoning,
    async onPayload(payload, requestModel) {
      let current = rewriteAliasPayload(payload, alias);
      const next = await originalOnPayload?.(current, requestModel);
      if (next !== undefined) current = next;
      return rewriteAliasPayload(current, alias);
    },
  };
}

function probeModel(): Model<"openai-codex-responses"> {
  return {
    id: UPSTREAM_MODEL,
    name: "GPT-5.6 Sol",
    api: CODEX_API,
    provider: PROVIDER,
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: UPSTREAM_COST,
    contextWindow: 272000,
    maxTokens: 128000,
  };
}

function openaiProbeModel(): Model<"openai-responses"> {
  return {
    id: UPSTREAM_MODEL,
    name: "GPT-5.6 Sol",
    api: OPENAI_API,
    provider: OPENAI_PROVIDER,
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text"],
    cost: OPENAI_COST,
    contextWindow: 272000,
    maxTokens: 128000,
  };
}

async function drain(stream: AssistantMessageEventStream): Promise<void> {
  for await (const _event of stream) {
    // Drain the probe stream so lazy provider registration finishes.
  }
}

async function loadApiProvider(api: string, model: Model<any>, apiKey: string): Promise<CodexProvider> {
  const lazyProvider = getApiProvider(api);
  if (!lazyProvider) throw new Error(`Could not find built-in ${api} provider to wrap.`);

  const controller = new AbortController();
  controller.abort();

  await drain(
    lazyProvider.stream(model, { systemPrompt: "", messages: [] } satisfies Context, {
      apiKey,
      signal: controller.signal,
      transport: "sse",
      maxRetries: 0,
    }),
  ).catch(() => undefined);

  return getApiProvider(api) ?? lazyProvider;
}

export default async function (pi: ExtensionAPI) {
  const codexProvider = await loadApiProvider(CODEX_API, probeModel(), PROVIDER_PROBE_JWT);
  const openaiProvider = await loadApiProvider(OPENAI_API, openaiProbeModel(), "sk-pi-extension-probe");

  // Compaction invokes the provider's streamSimple directly and does not carry
  // Pi's before_provider_request hook, so normalize aliases at this boundary.
  pi.registerProvider(PROVIDER, {
    api: CODEX_API,
    streamSimple: (model, context, options) =>
      codexProvider.stream(toUpstreamModel(model), context, createCodexOptions(model, options)),
  });

  pi.registerProvider(OPENAI_PROVIDER, {
    api: OPENAI_API,
    streamSimple: (model, context, options) =>
      openaiProvider.stream(toUpstreamModel(model), context, createCodexOptions(model, options)),
  });

  pi.on("model_select", () => {
    warnedThresholdCompaction = false;
  });

  pi.on("message_end", (event, ctx) => {
    const alias = selectedAlias(ctx.model);
    if (!alias) return;

    const message = asRecord(event.message);
    if (message?.role === "assistant" && message.provider === ctx.model?.provider && message.model === upstreamModelId(alias)) {
      message.model = alias;
    }
  });

  pi.on("session_before_compact", (event, ctx) => {
    if (!isOneMillionSol(ctx.model) || event.reason !== "threshold") return;

    if (!warnedThresholdCompaction) {
      ctx.ui.notify(
        `Skipping threshold auto-compaction for ${OPENAI_PROVIDER}/${ONE_MILLION_MODEL}; preserving the full 1M context until provider overflow or manual /compact.`,
        "info",
      );
      warnedThresholdCompaction = true;
    }

    return { cancel: true };
  });

  pi.on("before_provider_request", (event, ctx) => {
    const payloadModel = asRecord(event.payload)?.model;
    const payloadAlias =
      (ctx.model && typeof payloadModel === "string"
        ? selectedAlias({ ...ctx.model, id: payloadModel })
        : undefined) ?? selectedAlias(ctx.model);
    return rewriteAliasPayload(event.payload, payloadAlias);
  });
}
