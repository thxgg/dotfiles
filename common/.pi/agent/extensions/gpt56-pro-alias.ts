import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";

type PiModel = NonNullable<ExtensionContext["model"]>;
type JsonRecord = Record<string, unknown>;
type OpenAIProvider = NonNullable<ReturnType<typeof getApiProvider>>;

const PROVIDER = "openai";
const API = "openai-responses";
const ALIAS_MODEL = "gpt-5.6-pro";
const UPSTREAM_MODEL = "gpt-5.6-sol";
const PROVIDER_PROBE_KEY = "pi-extension-provider-probe";

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function isProAlias(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === ALIAS_MODEL;
}

function toUpstreamModel(model: Model<any>): Model<any> {
  if (!isProAlias(model)) return model;
  return { ...model, id: UPSTREAM_MODEL };
}

function rewritePayload(payload: unknown, enabled: boolean): unknown {
  const body = asRecord(payload);
  if (!body || !enabled) return payload;

  return {
    ...body,
    model: UPSTREAM_MODEL,
    reasoning: {
      ...asRecord(body.reasoning),
      mode: "pro",
    },
  };
}

async function drain(stream: AssistantMessageEventStream): Promise<void> {
  for await (const _event of stream) {
    // Drain the aborted probe so lazy provider registration finishes.
  }
}

async function loadOpenAIProvider(): Promise<OpenAIProvider> {
  const lazyProvider = getApiProvider(API);
  if (!lazyProvider) throw new Error(`Could not find built-in ${API} provider to wrap.`);

  const controller = new AbortController();
  controller.abort();

  const probeModel: Model<"openai-responses"> = {
    id: UPSTREAM_MODEL,
    name: "GPT-5.6 Sol",
    api: API,
    provider: PROVIDER,
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 272000,
    maxTokens: 128000,
  };

  await drain(
    lazyProvider.stream(probeModel, { systemPrompt: "", messages: [] } satisfies Context, {
      apiKey: PROVIDER_PROBE_KEY,
      signal: controller.signal,
      transport: "sse",
      maxRetries: 0,
    }),
  ).catch(() => undefined);

  return getApiProvider(API) ?? lazyProvider;
}

export default async function (pi: ExtensionAPI) {
  const openAIProvider = await loadOpenAIProvider();

  // Compaction calls streamSimple directly, so apply the alias at the provider boundary too.
  pi.registerProvider(PROVIDER, {
    api: API,
    streamSimple: (model, context, options?: SimpleStreamOptions) => {
      const enabled = isProAlias(model);
      const originalOnPayload = options?.onPayload;
      return openAIProvider.stream(toUpstreamModel(model), context, {
        ...options,
        async onPayload(payload, requestModel) {
          let current = rewritePayload(payload, enabled);
          const next = await originalOnPayload?.(current, requestModel);
          if (next !== undefined) current = next;
          return rewritePayload(current, enabled);
        },
      });
    },
  });

  pi.on("message_end", (event, ctx) => {
    if (!isProAlias(ctx.model)) return;
    const message = asRecord(event.message);
    if (message?.role === "assistant" && message.provider === PROVIDER && message.model === UPSTREAM_MODEL) {
      message.model = ALIAS_MODEL;
    }
  });

  pi.on("before_provider_request", (event, ctx) =>
    rewritePayload(event.payload, isProAlias(ctx.model) || asRecord(event.payload)?.model === ALIAS_MODEL),
  );
}
