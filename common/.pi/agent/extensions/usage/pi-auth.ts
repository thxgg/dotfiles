import { readStoredCredential, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { fail, ok, UsageFailure, type Result } from "./domain.ts";
import { Secret } from "./http.ts";
import type { SubscriptionAuth } from "./providers.ts";

/** Pi's auth adapter owns refresh and persistence; the quota extension never rotates tokens itself. */
export class PiSubscriptionAuth implements SubscriptionAuth {
  /** Obtain the current registry context lazily after session start. */
  constructor(private readonly context: () => { readonly modelRegistry: Pick<ModelRegistry, "getProviderAuth"> } | undefined, private readonly authPath: string) {}

  /** API keys and the new openai token-sharing login are not legacy subscription credentials. */
  async resolve(provider: "openai-codex" | "anthropic", signal: AbortSignal): Promise<Result<Secret>> {
    const ctx = this.context();
    if (!ctx || signal.aborted) return fail(new UsageFailure("cancelled", "No active Pi session is available."));
    try {
      const credential = readStoredCredential(provider, this.authPath);
      if (credential?.type !== "oauth") return fail(new UsageFailure("unsupported", provider === "openai-codex"
        ? "Legacy Codex quotas need /login openai-codex. The new openai login has a separate quota API and is not used here."
        : "Claude subscription quotas need /login anthropic with OAuth; API-key billing is separate."));
      // Pi serializes OAuth refresh and saves rotated credentials through its credential store.
      const resolved = await ctx.modelRegistry.getProviderAuth(provider);
      if (signal.aborted) return fail(new UsageFailure("cancelled", "Authentication was cancelled."));
      const latest = readStoredCredential(provider, this.authPath);
      const token = resolved?.auth.apiKey;
      if (resolved?.source !== "OAuth" || !token || latest?.type !== "oauth" || latest.access !== token) return fail(new UsageFailure("auth", "Pi did not resolve the stored OAuth login. Environment keys and alternate routes are not used for quota checks."));
      if (resolved.auth.baseUrl && new URL(resolved.auth.baseUrl).origin !== (provider === "anthropic" ? "https://api.anthropic.com" : "https://chatgpt.com")) return fail(new UsageFailure("unsupported", "A custom provider route cannot be used for subscription quota requests."));
      return ok(new Secret(token));
    } catch { return fail(new UsageFailure("auth", "Pi could not resolve subscription OAuth credentials. Use /login again.")); }
  }
}
