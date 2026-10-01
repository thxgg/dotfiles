import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessageEventStream, Model, SimpleStreamOptions, StreamOptions } from "@earendil-works/pi-ai";
import { clampThinkingLevel, normalizeContext } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";

type PiModel = NonNullable<ExtensionContext["model"]>;
type JsonRecord = Record<string, unknown>;
type ResponsesProvider = NonNullable<ReturnType<typeof getApiProvider>>;

const PROVIDER = "openai";
const RESPONSES_API = "openai-responses";
const UPSTREAM_MODEL = "gpt-6.1-sol";
const FAST_MODEL = "gpt-6.1-sol-fast";
const ASTRA_MODEL = "gpt-6-astra";
const ASTRA_FAST_MODEL = "gpt-6-astra-fast";
const ASTRA_ULTRAFAST_MODEL = "gpt-6-astra-ultrafast";
type Alias = typeof FAST_MODEL | typeof ASTRA_FAST_MODEL | typeof ASTRA_ULTRAFAST_MODEL;
const UPSTREAM_COST = {
  input: 2,
  output: 10,
  cacheRead: 0.1,
  cacheWrite: 2.5,
};
const PROVIDER_PROBE_KEY = "pi-openai-alias-probe";

function selectedAlias(model: PiModel | undefined): Alias | undefined {
  if (model?.provider === PROVIDER && (model.id === FAST_MODEL || model.id === ASTRA_FAST_MODEL || model.id === ASTRA_ULTRAFAST_MODEL)) return model.id;
  return undefined;
}

function serviceTierForAlias(alias: Alias): "priority" | "ultrafast" {
  return alias === ASTRA_ULTRAFAST_MODEL ? "ultrafast" : "priority";
}

function upstreamModelId(alias: Alias): string {
  return alias === FAST_MODEL ? UPSTREAM_MODEL : ASTRA_MODEL;
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  // SAFETY: The guard excludes null, primitives, and arrays. Payload fields remain unknown.
  return value as JsonRecord;
}

function toUpstreamModel(model: Model<Api>): Model<Api> {
  const alias = selectedAlias(model);
  if (!alias) return model;

  return {
    ...model,
    id: upstreamModelId(alias),
    cost: model.cost,
  };
}

function rewriteAliasPayload(payload: unknown, alias: Alias | undefined): unknown {
  const body = asRecord(payload);
  if (!body || !alias) return payload;

  return {
    ...body,
    model: upstreamModelId(alias),
    service_tier: serviceTierForAlias(alias),
  };
}

type ResponsesOptions = StreamOptions & {
  serviceTier?: string;
  reasoningEffort?: SimpleStreamOptions["reasoning"];
};

function createResponsesOptions(model: Model<Api>, options?: SimpleStreamOptions): ResponsesOptions {
  const alias = selectedAlias(model);
  // SAFETY: Responses-only optional fields are forwarded to the same provider boundary.
  const responsesOptions = options as ResponsesOptions | undefined;
  const serviceTier = alias ? serviceTierForAlias(alias) : responsesOptions?.serviceTier;
  const originalOnPayload = options?.onPayload;
  const reasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;

  return {
    ...responsesOptions,
    serviceTier,
    // Match the native simple stream’s thinking-level clamping.
    reasoningEffort: reasoning === "off" ? undefined : reasoning,
    async onPayload(payload, requestModel) {
      let current = rewriteAliasPayload(payload, alias);
      const next = await originalOnPayload?.(current, requestModel);
      if (next !== undefined) current = next;
      return rewriteAliasPayload(current, alias);
    },
  };
}

function probeModel(): Model<"openai-responses"> {
  return {
    id: UPSTREAM_MODEL,
    name: "GPT-6.1 Sol",
    api: RESPONSES_API,
    provider: PROVIDER,
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text"],
    cost: UPSTREAM_COST,
    contextWindow: 272000,
    maxTokens: 128000,
  };
}

async function drain(stream: AssistantMessageEventStream): Promise<void> {
  for await (const _event of stream) {
    // Drain the probe stream so lazy provider registration finishes.
  }
}

async function loadApiProvider(api: string, model: Model<Api>, apiKey: string): Promise<ResponsesProvider> {
  const lazyProvider = getApiProvider(api);
  if (!lazyProvider) throw new Error(`Could not find built-in ${api} provider to wrap.`);

  const controller = new AbortController();
  controller.abort();

  await drain(
    lazyProvider.stream(model, normalizeContext({ messages: [] }), {
      apiKey,
      signal: controller.signal,
      transport: "sse",
      maxRetries: 0,
    }),
  ).catch(() => undefined);

  return getApiProvider(api) ?? lazyProvider;
}

/** Route OpenAI chat through reusable WebSockets and preserve speed aliases/compaction. */
export default async function (pi: ExtensionAPI) {
  const responsesProvider = await loadApiProvider(RESPONSES_API, probeModel(), PROVIDER_PROBE_KEY);
  // Pi's loader resolves relative imports from the live Stow symlink. Resolve the
  // source entry first so both existing leaf links and freshly deployed trees work.
  const sourceDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
  const transportModule: typeof import("../lib/openai-websocket.ts") = await import(
    pathToFileURL(resolve(sourceDir, "../lib/openai-websocket.ts")).href
  );
  const transport = transportModule.createOpenAIWebSocketTransport();
  pi.on("session_shutdown", () => transport.close());
  pi.on("session_start", () => transport.close());

  // Compaction invokes the provider's streamSimple directly and does not carry
  // Pi's before_provider_request hook, so normalize aliases at this boundary.
  pi.registerProvider(PROVIDER, {
    api: RESPONSES_API,
    streamSimple: (model, context, options) => selectedAlias(model)
      ? responsesProvider.stream(toUpstreamModel(model), context, transport.options(model, createResponsesOptions(model, options)))
      : responsesProvider.streamSimple(model, context, transport.options(model, options ?? {})),
  });

  pi.on("message_end", (event, ctx) => {
    const alias = selectedAlias(ctx.model);
    if (!alias) return;

    const message = asRecord(event.message);
    if (message?.role === "assistant" && message.provider === ctx.model?.provider && message.model === upstreamModelId(alias)) {
      message.model = alias;
    }
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
