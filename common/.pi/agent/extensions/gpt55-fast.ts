import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type PiModel = NonNullable<ExtensionContext["model"]>;
type JsonRecord = Record<string, unknown>;

const PROVIDER = "openai-codex";
const BASE_MODEL = "gpt-5.5";
const FAST_MODEL = "gpt-5.5-fast";
const ONE_MILLION_MODEL = "gpt-5.5-1m";
const STATUS_KEY = "gpt55-fast";
const FAST_SERVICE_TIER = "priority";

let fastEnabledForBaseModel = false;
let normalizingAliasModel = false;

function isBaseGpt55(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === BASE_MODEL;
}

function isFastGpt55(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === FAST_MODEL;
}

function isOneMillionGpt55(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === ONE_MILLION_MODEL;
}

function isSupportedModel(model: PiModel | undefined): boolean {
  return isBaseGpt55(model) || isFastGpt55(model);
}

function isFastActive(model: PiModel | undefined): boolean {
  return isFastGpt55(model) || (isBaseGpt55(model) && fastEnabledForBaseModel);
}

function formatModel(model: PiModel | undefined): string {
  return model ? `${model.provider}/${model.id}` : "none";
}

function updateStatus(ctx: ExtensionContext, model: PiModel | undefined = ctx.model): void {
  if (isFastActive(model)) {
    ctx.ui.setStatus(STATUS_KEY, "GPT-5.5 Fast");
  } else {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function resolveRequestedState(args: string, current: boolean): boolean | undefined {
  const normalized = args.trim().toLowerCase();
  if (!normalized || normalized === "toggle") return !current;
  if (["on", "enable", "enabled", "true", "1", "yes"].includes(normalized)) return true;
  if (["off", "disable", "disabled", "false", "0", "no"].includes(normalized)) return false;
  if (["status", "state"].includes(normalized)) return current;
  return undefined;
}

async function switchToBaseModel(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
  if (isBaseGpt55(ctx.model)) return true;

  const baseModel = ctx.modelRegistry.find(PROVIDER, BASE_MODEL);
  if (!baseModel) {
    ctx.ui.notify(`Could not find ${PROVIDER}/${BASE_MODEL}.`, "error");
    return false;
  }

  const switched = await pi.setModel(baseModel);
  if (!switched) {
    ctx.ui.notify(`Could not switch to ${PROVIDER}/${BASE_MODEL}.`, "error");
  }
  return switched;
}

async function normalizeAliasModel(pi: ExtensionAPI, ctx: ExtensionContext, model: PiModel | undefined): Promise<boolean> {
  if (!model || normalizingAliasModel) return false;

  if (isFastGpt55(model)) {
    normalizingAliasModel = true;
    try {
      const switched = await switchToBaseModel(pi, ctx);
      if (switched) {
        fastEnabledForBaseModel = true;
        ctx.ui.setStatus(STATUS_KEY, "GPT-5.5 Fast");
        ctx.ui.notify(`${PROVIDER}/${FAST_MODEL} is a local alias; using ${PROVIDER}/${BASE_MODEL} with priority service tier.`, "info");
      }
      return switched;
    } finally {
      normalizingAliasModel = false;
    }
  }

  if (isOneMillionGpt55(model)) {
    normalizingAliasModel = true;
    try {
      const switched = await switchToBaseModel(pi, ctx);
      if (switched) {
        fastEnabledForBaseModel = false;
        ctx.ui.setStatus(STATUS_KEY, undefined);
        ctx.ui.notify(
          `${PROVIDER}/${ONE_MILLION_MODEL} is not supported by Codex ChatGPT accounts; using ${PROVIDER}/${BASE_MODEL} instead.`,
          "warning",
        );
      }
      return switched;
    } finally {
      normalizingAliasModel = false;
    }
  }

  return false;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("fast", {
    description: "Toggle GPT-5.5 Fast mode (openai-codex/gpt-5.5 only)",
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
        fastEnabledForBaseModel = false;
        updateStatus(ctx);
        ctx.ui.notify(`/fast is only available for ${PROVIDER}/${BASE_MODEL}. Current model: ${formatModel(ctx.model)}`, "warning");
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
          if (isFastGpt55(ctx.model)) await normalizeAliasModel(pi, ctx, ctx.model);
          updateStatus(ctx);
          ctx.ui.notify("GPT-5.5 Fast mode is already on.", "info");
          return;
        }

        if (isFastGpt55(ctx.model)) {
          const switched = await switchToBaseModel(pi, ctx);
          if (!switched) {
            updateStatus(ctx);
            return;
          }
        }

        // Keep the real Codex model selected. Pi's built-in compaction path does
        // not run before_provider_request hooks, so local alias model ids can leak
        // into summarization requests and fail as unsupported.
        fastEnabledForBaseModel = true;
        ctx.ui.setStatus(STATUS_KEY, "GPT-5.5 Fast");
        ctx.ui.notify("GPT-5.5 Fast mode enabled for this session.", "info");
        return;
      }

      if (isFastGpt55(ctx.model)) {
        const switched = await switchToBaseModel(pi, ctx);
        if (!switched) {
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
    if (await normalizeAliasModel(pi, ctx, ctx.model)) return;
    if (!isSupportedModel(ctx.model)) fastEnabledForBaseModel = false;
    updateStatus(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    if (normalizingAliasModel) {
      updateStatus(ctx, event.model);
      return;
    }
    if (await normalizeAliasModel(pi, ctx, event.model)) return;
    if (!isBaseGpt55(event.model)) fastEnabledForBaseModel = false;
    updateStatus(ctx, event.model);
  });

  pi.on("before_provider_request", (event, ctx) => {
    const payload = asRecord(event.payload);
    if (!payload) return undefined;

    const payloadModel = typeof payload.model === "string" ? payload.model : undefined;
    const shouldUseFastTier = isFastActive(ctx.model) || payloadModel === FAST_MODEL;
    const shouldRewriteAlias = shouldUseFastTier || isOneMillionGpt55(ctx.model) || payloadModel === ONE_MILLION_MODEL;
    if (!shouldRewriteAlias) return undefined;

    return {
      ...payload,
      // Local aliases are for Pi's selector/metadata only. The Codex backend
      // expects the upstream GPT-5.5 model id; Fast additionally uses the
      // priority service tier.
      model: BASE_MODEL,
      ...(shouldUseFastTier ? { service_tier: FAST_SERVICE_TIER } : {}),
    };
  });
}
