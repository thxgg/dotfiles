import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type PiModel = NonNullable<ExtensionContext["model"]>;
type JsonRecord = Record<string, unknown>;

const PROVIDER = "openai-codex";
const BASE_MODEL = "gpt-5.5";
const FAST_MODEL = "gpt-5.5-fast";
const STATUS_KEY = "gpt55-fast";
const FAST_SERVICE_TIER = "priority";

let fastEnabledForBaseModel = false;

function isBaseGpt55(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === BASE_MODEL;
}

function isFastGpt55(model: PiModel | undefined): boolean {
  return model?.provider === PROVIDER && model.id === FAST_MODEL;
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
        if (isFastGpt55(ctx.model)) {
          fastEnabledForBaseModel = false;
          updateStatus(ctx);
          ctx.ui.notify("GPT-5.5 Fast mode is already on.", "info");
          return;
        }

        const fastModel = ctx.modelRegistry.find(PROVIDER, FAST_MODEL);
        if (fastModel) {
          const switched = await pi.setModel(fastModel);
          if (switched) {
            fastEnabledForBaseModel = false;
            ctx.ui.setStatus(STATUS_KEY, "GPT-5.5 Fast");
            ctx.ui.notify(`Switched to ${PROVIDER}/${FAST_MODEL}.`, "info");
            return;
          }
        }

        // Fallback if the alias model is unavailable for any reason: keep the
        // base model selected and inject the fast service tier per request.
        fastEnabledForBaseModel = true;
        updateStatus(ctx);
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
    if (!isSupportedModel(ctx.model)) fastEnabledForBaseModel = false;
    updateStatus(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    if (!isBaseGpt55(event.model)) fastEnabledForBaseModel = false;
    updateStatus(ctx, event.model);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!isFastActive(ctx.model)) return undefined;

    const payload = asRecord(event.payload);
    if (!payload) return undefined;

    return {
      ...payload,
      // The local alias is for Pi's model selector only. Codex expects the
      // upstream model id plus service_tier=priority for Fast mode.
      model: BASE_MODEL,
      service_tier: FAST_SERVICE_TIER,
    };
  });
}
