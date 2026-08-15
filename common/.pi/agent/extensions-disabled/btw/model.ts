import type { Model } from "@earendil-works/pi-ai";

const SOL_UPSTREAM = "gpt-5.6-sol";
const SOL_FAST = "gpt-5.6-sol-fast";
const SOL_ONE_MILLION = "gpt-5.6-sol-1m";
const SOL_PRO = "gpt-5.6-pro";

export interface SideModelResolution {
  model: Model<any>;
  rewritePayload(payload: unknown): unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Resolve local model aliases without loading the parent's extension stack. */
export function resolveSideModel(model: Model<any>): SideModelResolution {
  const codexAlias = model.provider === "openai-codex" && (model.id === SOL_FAST || model.id === SOL_ONE_MILLION);
  const proAlias = model.provider === "openai" && model.id === SOL_PRO;
  if (!codexAlias && !proAlias) return { model, rewritePayload: (payload) => payload };

  const resolved = { ...model, id: SOL_UPSTREAM };
  return {
    model: resolved,
    rewritePayload(payload) {
      const body = asRecord(payload);
      if (!body) return payload;
      return {
        ...body,
        model: SOL_UPSTREAM,
        ...(model.id === SOL_FAST ? { service_tier: "priority" } : {}),
        ...(proAlias ? { reasoning: { ...asRecord(body.reasoning), mode: "pro" } } : {}),
      };
    },
  };
}
