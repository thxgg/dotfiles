import { inspect } from "node:util";
import { fail, ok, UsageFailure, type Result } from "./domain.ts";

/** Secret values cannot be serialized into state, notifications, or logs. */
export class Secret {
  #value: string;
  /** Capture a boundary value; reveal it only while constructing a request. */
  constructor(value: string) { this.#value = value; }
  /** Network adapters alone need the original value. */
  reveal(): string { return this.#value; }
  /** Redact JSON diagnostics. */
  toJSON(): string { return "[REDACTED]"; }
  /** Redact string diagnostics. */
  toString(): string { return "[REDACTED]"; }
  /** Redact Node console/inspect output as well as JSON. */
  [inspect.custom](): string { return "[REDACTED]"; }
}

/** Only these fixed-origin routes can receive provider credentials. */
export type Endpoint =
  | { readonly kind: "codexUsage" }
  | { readonly kind: "codexInventory" }
  | { readonly kind: "codexConsume"; readonly creditId: string; readonly requestId: string }
  | { readonly kind: "claudeProfile" }
  | { readonly kind: "claudeUsage" }
  | { readonly kind: "claudeConsume"; readonly organization: string; readonly creditId: string; readonly requestId: string };

/** Authentication stays outside snapshots and domain policy. */
export interface RequestCredential {
  readonly token: Secret;
  readonly accountId?: string;
}

/** Retry-After accepts seconds or HTTP dates; clamp unreasonable provider values. */
export function retryDeadline(value: string | null, now: number): number {
  const seconds = value !== null && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const parsed = value !== null ? Date.parse(value) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(parsed) ? parsed - now : 15 * 60_000;
  return now + Math.max(30_000, Math.min(60 * 60_000, delay));
}

/** Provider HTTP adapter with bounded reads, redirect rejection, and no generation probes. */
export class QuotaHttp {
  /** Inject a request adapter for offline tests, never patch global fetch. */
  constructor(private readonly fetcher: typeof fetch, private readonly now: () => number) {}

  /** One request, no retry/fallback chain. Mutation ambiguity retains its ID upstream. */
  async request(endpoint: Endpoint, credential: RequestCredential, signal: AbortSignal): Promise<Result<unknown>> {
    const codex = endpoint.kind.startsWith("codex");
    const mutation = endpoint.kind === "codexConsume" || endpoint.kind === "claudeConsume";
    const base = codex ? "https://chatgpt.com" : "https://api.anthropic.com";
    let path: string;
    let body: string | undefined;
    switch (endpoint.kind) {
      case "codexUsage": path = "/backend-api/wham/usage"; break;
      case "codexInventory": path = "/backend-api/wham/rate-limit-reset-credits"; break;
      case "claudeProfile": path = "/api/oauth/profile"; break;
      case "claudeUsage": path = "/api/oauth/usage?cedar_ember=1&skip_spend=1"; break;
      case "codexConsume":
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(endpoint.creditId) || !/^[A-Za-z0-9_-]{1,64}$/.test(endpoint.requestId)) return fail(new UsageFailure("invalid", "Invalid reset identifiers.", undefined, true));
        path = "/backend-api/wham/rate-limit-reset-credits/consume";
        body = JSON.stringify({ credit_id: endpoint.creditId, redeem_request_id: endpoint.requestId });
        break;
      case "claudeConsume":
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(endpoint.organization) || !/^[a-z0-9_-]{1,40}$/.test(endpoint.creditId) || !/^[A-Za-z0-9_-]{1,64}$/.test(endpoint.requestId)) return fail(new UsageFailure("invalid", "Invalid Claude reset identifiers.", undefined, true));
        path = `/api/organizations/${encodeURIComponent(endpoint.organization)}/reset_rate_limits`;
        body = JSON.stringify({ program: "cedar_ember", grant_id: endpoint.creditId, request_id: endpoint.requestId });
        break;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.token.reveal()}`,
      Accept: "application/json",
      "User-Agent": "pi-subscription-usage/1.0",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(codex ? { "OpenAI-Beta": "responses=experimental", originator: "Codex Desktop",
        ...(credential.accountId ? { "ChatGPT-Account-ID": credential.accountId } : {}) }
        : { "anthropic-beta": "oauth-2025-04-20" }),
    };
    const timeout = AbortSignal.timeout(mutation ? 25_000 : 10_000);
    const combined = AbortSignal.any([signal, timeout]);
    if (signal.aborted) return fail(new UsageFailure("cancelled", "Usage request cancelled before sending.", undefined, true));
    try {
      const response = await this.fetcher(`${base}${path}`, {
        method: mutation ? "POST" : "GET", headers, ...(body ? { body } : {}),
        redirect: "error", signal: combined,
      });
      if (!response.ok) {
        // Cancellation can wait for a tee consumer in caller-owned fetch adapters.
        void response.body?.cancel().catch(() => undefined);
        if (response.status === 429) return fail(new UsageFailure("rateLimited", "The usage/reset endpoint is throttled. This does not prove model quota exhaustion.", retryDeadline(response.headers.get("retry-after"), this.now()), true));
        if (response.status === 401 || response.status === 403) return fail(new UsageFailure("auth", "The provider rejected subscription credentials. Use /login again.", undefined, true));
        return fail(new UsageFailure(mutation && response.status >= 500 ? "uncertain" : "http", `Subscription endpoint returned HTTP ${response.status}.`, undefined, response.status < 500));
      }
      if (!response.body) return fail(new UsageFailure(mutation ? "uncertain" : "invalid", "The provider returned an empty response."));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let raw = "", bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 512 * 1024) {
            void reader.cancel().catch(() => undefined);
            return fail(new UsageFailure(mutation ? "uncertain" : "invalid", "The provider response exceeded the safe size limit."));
          }
          raw += decoder.decode(chunk.value, { stream: true });
        }
        raw += decoder.decode();
      } finally { reader.releaseLock(); }
      try { const parsed: unknown = JSON.parse(raw); return ok(parsed); }
      catch { return fail(new UsageFailure(mutation ? "uncertain" : "invalid", "The provider returned invalid JSON.")); }
    } catch {
      return fail(new UsageFailure(mutation ? "uncertain" : signal.aborted ? "cancelled" : "network",
        mutation ? "The reset response was lost. Retry the same credit to reuse its request ID." : "The subscription request failed or timed out."));
    }
  }
}
