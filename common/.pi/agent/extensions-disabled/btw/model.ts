import type { Api, Model } from "@earendil-works/pi-ai";

export interface SideModelResolution {
  model: Model<Api>;
  rewritePayload(payload: unknown): unknown;
}

/** Resolve supported Fast aliases without retaining retired Pro or 1M aliases. */
export function resolveSideModel(model: Model<Api>): SideModelResolution {
  const upstream = model.provider === "openai-codex"
    ? model.id === "gpt-6-sol-fast" ? "gpt-6-sol"
      : model.id === "gpt-6-astra-fast" ? "gpt-6-astra" : undefined
    : undefined;
  if (!upstream) return { model, rewritePayload: payload => payload };
  return {
    model: { ...model, id: upstream },
    rewritePayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
      return { ...payload, model: upstream, service_tier: "priority" };
    },
  };
}
