import { createHash } from "node:crypto";
import { fail, ok, UsageFailure, type Account, type Result, type ResetOutcome, type Snapshot, type Provider } from "./domain.ts";
import { QuotaHttp, Secret, type RequestCredential } from "./http.ts";
import { parseAnthropicUsage, parseCodexInventory, parseCodexUsage, parseResetOutcome, record, text } from "./protocol.ts";
import type { SubscriptionClient } from "./service.ts";

/** Pi resolves and refreshes its own OAuth token; no CLI auth-file fallback. */
export interface SubscriptionAuth {
  resolve(provider: "openai-codex" | "anthropic", signal: AbortSignal): Promise<Result<Secret>>;
}

interface Identity {
  readonly account: Account;
  readonly credential: RequestCredential;
  readonly organization?: string;
}

/** Hash stable account identity, not access tokens that rotate during refresh. */
export function accountKey(provider: Provider, identity: string): string {
  return `${provider}-${createHash("sha256").update(identity).digest("hex")}`;
}

function codexIdentity(token: Secret): Result<Identity> {
  try {
    const encoded = token.reveal().split(".")[1];
    if (!encoded) return fail(new UsageFailure("auth", "Codex OAuth has no account claim. Use /login openai-codex."));
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const payload = record(parsed);
    const accountId = text(record(payload?.["https://api.openai.com/auth"])?.chatgpt_account_id);
    const subject = text(payload?.sub);
    if (!accountId || !subject || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) return fail(new UsageFailure("auth", "Codex OAuth is missing a usable account identity."));
    // The claim is an isolation hint from Pi's credential, not a JWT authentication decision.
    const key = accountKey("codex", `${subject}:${accountId}`);
    return ok({ account: { provider: "codex", key, accountId, label: `Legacy Codex account ${accountId}` }, credential: { token, accountId } });
  } catch { return fail(new UsageFailure("auth", "Codex OAuth account claims could not be decoded.")); }
}

/** Read-only quota client plus explicit reset mutation for one Pi OAuth provider. */
export class ProviderQuotaClient implements SubscriptionClient {
  private profile: { readonly tokenHash: string; readonly identity: Identity; readonly expiresAt: number } | undefined;
  private profileFailure: { readonly tokenHash: string; readonly error: UsageFailure; readonly retryAt: number } | undefined;

  /** Wire fixed-origin HTTP and Pi-owned authentication. */
  constructor(private readonly provider: Provider, private readonly auth: SubscriptionAuth, private readonly http: QuotaHttp, private readonly now: () => number) {}

  private async identity(signal: AbortSignal): Promise<Result<Identity>> {
    const resolved = await this.auth.resolve(this.provider === "codex" ? "openai-codex" : "anthropic", signal);
    if (!resolved.ok) return resolved;
    if (this.provider === "codex") return codexIdentity(resolved.value);
    const tokenHash = createHash("sha256").update(resolved.value.reveal()).digest("hex");
    if (this.profile?.tokenHash === tokenHash && this.profile.expiresAt > this.now()) return ok(this.profile.identity);
    if (this.profileFailure?.tokenHash === tokenHash && this.profileFailure.retryAt > this.now()) return fail(this.profileFailure.error);
    const credential = { token: resolved.value };
    const response = await this.http.request({ kind: "claudeProfile" }, credential, signal);
    if (!response.ok) {
      // Session cancellation is not provider backoff. A new session must be able
      // to discover the account immediately after the old request is aborted.
      if (signal.aborted) return response;
      this.profileFailure = { tokenHash, error: response.error, retryAt: response.error.retryAt ?? this.now() + 5 * 60_000 };
      return response;
    }
    const payload = record(response.value);
    const organization = record(payload?.organization);
    const uuid = text(organization?.uuid);
    const account = record(payload?.account);
    const userId = text(account?.uuid);
    if (!uuid || !userId || !/^[A-Za-z0-9_-]{1,128}$/.test(uuid)) return fail(new UsageFailure("auth", "Claude's profile did not identify its OAuth account and organization. Resets are disabled."));
    const organizationName = text(organization?.name) ?? uuid;
    const identity: Identity = {
      account: { provider: "anthropic", key: accountKey("anthropic", `${userId}:${uuid}`), organizationName, label: `Claude · ${organizationName}` },
      credential, organization: uuid,
    };
    this.profile = { tokenHash, identity, expiresAt: this.now() + 5 * 60_000 };
    this.profileFailure = undefined;
    return ok(identity);
  }

  /** Account discovery is independent of selected model aliases. */
  async discover(signal: AbortSignal): Promise<Result<Account>> {
    const result = await this.identity(signal);
    return result.ok ? ok(result.value.account) : result;
  }

  private async forAccount(account: Account, signal: AbortSignal): Promise<Result<Identity>> {
    const identity = await this.identity(signal);
    if (!identity.ok) return identity;
    if (account.provider !== this.provider || identity.value.account.key !== account.key) return fail(new UsageFailure("accountChanged", "The provider login changed. Open /usage again.", undefined, true));
    return identity;
  }

  /** Missing reset inventory never removes successfully read quota bars. */
  async read(account: Account, signal: AbortSignal): Promise<Result<Snapshot>> {
    const identity = await this.forAccount(account, signal);
    if (!identity.ok) return identity;
    const response = await this.http.request({ kind: this.provider === "codex" ? "codexUsage" : "claudeUsage" }, identity.value.credential, signal);
    if (!response.ok) return response;
    if (this.provider === "anthropic") return parseAnthropicUsage(response.value, account, this.now());
    const usage = parseCodexUsage(response.value, account, this.now());
    if (!usage.ok) return usage;
    const inventoryResponse = await this.http.request({ kind: "codexInventory" }, identity.value.credential, signal);
    const inventory = inventoryResponse.ok ? parseCodexInventory(inventoryResponse.value, this.now()) : inventoryResponse;
    return ok({ ...usage.value, inventory: inventory.ok ? inventory.value : { kind: "unavailable", message: inventory.error.message },
      ...(!inventoryResponse.ok && inventoryResponse.error.retryAt !== undefined ? { queryRetryAt: inventoryResponse.error.retryAt } : {}) });
  }

  /** No token fallback, shape guessing, or automatic mutation retry. */
  async consume(account: Account, creditId: string, requestId: string, signal: AbortSignal): Promise<Result<ResetOutcome>> {
    const identity = await this.forAccount(account, signal);
    if (!identity.ok) return identity;
    if (this.provider === "anthropic" && !identity.value.organization) return fail(new UsageFailure("auth", "Claude organization is unknown.", undefined, true));
    const endpoint = this.provider === "codex"
      ? { kind: "codexConsume", creditId, requestId } as const
      : { kind: "claudeConsume", organization: identity.value.organization ?? "", creditId, requestId } as const;
    const response = await this.http.request(endpoint, identity.value.credential, signal);
    return response.ok ? parseResetOutcome(this.provider, response.value) : response;
  }
}
