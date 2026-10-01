/** Provider accounts supported by the subscription monitor. */
export type Provider = "codex" | "anthropic";

/** Known integration failures, safe to display without raw provider bodies. */
export class UsageFailure extends Error {
  /** Stable discriminator for integration failures. */
  readonly tag = "UsageFailure";
  /** Classifies recovery without inspecting an error sentence. */
  constructor(
    readonly kind: "auth" | "unsupported" | "http" | "rateLimited" | "network" | "invalid" | "storage" | "busy" | "cancelled" | "accountChanged" | "uncertain",
    message: string,
    readonly retryAt?: number,
    readonly settled = false,
  ) { super(message); }
}

/** Expected failures are values at each integration boundary. */
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: UsageFailure };
/** Construct a successful boundary result. */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
/** Construct a failed boundary result. */
export const fail = <T = never>(error: UsageFailure): Result<T> => ({ ok: false, error });

/** A quota window. Reset timestamps use milliseconds, never epoch seconds. */
export interface Window {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly durationMins?: number;
  readonly resetsAt?: number;
  readonly detail?: string;
}

/** One provider-reported reset credit or Claude grant. */
export interface ResetCredit {
  readonly id: string;
  readonly count: number;
  readonly status: "available" | "expired" | "paused" | "unavailable" | "redeemed" | "unknown";
  readonly expiresAt?: number;
  readonly detail?: string;
}

/** Unknown inventory is not an empty inventory. */
export type Inventory =
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "known"; readonly credits: readonly ResetCredit[] };

/** Non-secret account metadata used for isolation and confirmation. */
export interface Account {
  readonly provider: Provider;
  readonly key: string;
  readonly label: string;
  readonly accountId?: string;
  readonly organizationName?: string;
}

/** An account snapshot contains no credentials or raw error bodies. */
export interface Snapshot {
  readonly account: Account;
  readonly checkedAt: number;
  readonly windows: readonly Window[];
  readonly inventory: Inventory;
  readonly plan?: string;
  readonly purchasedCredits?: number;
  readonly notice?: string;
  readonly limitReason?: string;
  /** Optional inventory-query throttle must also delay the next shared read. */
  readonly queryRetryAt?: number;
}

/** A sparse runtime update must not clear windows it does not include. */
export interface Update {
  readonly windows: readonly Window[];
  readonly notice?: string;
  readonly blocking?: { readonly windowId: string; readonly rejected: boolean };
}

/** Explicit provider outcomes for reset mutations. */
export type ResetOutcome = "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit";

/** Durable idempotency state survives reload, restart, and ambiguous failures. */
export interface PendingReset {
  readonly creditId: string;
  readonly requestId: string;
}

/** Account-scoped state shared by concurrent Pi processes. */
export interface AccountState {
  readonly snapshot?: Snapshot;
  readonly nextPollAt?: number;
  /** Endpoint failures delay both manual reads and reset mutations. */
  readonly cooldownUntil?: number;
  readonly pending?: PendingReset;
}

/** Recheck expiry at selection and redemption, not only when inventory was read. */
export function canRedeem(credit: ResetCredit, now: number): boolean {
  return credit.status === "available" && credit.count > 0 &&
    (credit.expiresAt === undefined || credit.expiresAt > now);
}

/** Fold a sparse event onto the most recent account read. */
export function mergeUpdate(snapshot: Snapshot, update: Update, now: number): Snapshot {
  const windows = new Map(snapshot.windows.map(window => [window.id, window]));
  for (const window of update.windows) {
    const previous = windows.get(window.id);
    windows.set(window.id, {
      ...previous, ...window,
      ...(window.durationMins === undefined && previous ? { label: previous.label } : {}),
      ...(window.resetsAt === undefined && previous?.resetsAt !== undefined ? { resetsAt: previous.resetsAt } : {}),
      ...(window.durationMins === undefined && previous?.durationMins !== undefined ? { durationMins: previous.durationMins } : {}),
    });
  }
  return { ...snapshot, checkedAt: now, windows: [...windows.values()],
    ...(update.notice !== undefined ? { notice: update.notice } : {}) };
}
