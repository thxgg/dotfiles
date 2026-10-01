import { canRedeem, fail, mergeUpdate, ok, UsageFailure, type Account, type AccountState, type Provider, type ResetOutcome, type Result, type Snapshot, type Update } from "./domain.ts";

/** Provider boundary: all requests are account-scoped and return parsed values. */
export interface SubscriptionClient {
  discover(signal: AbortSignal): Promise<Result<Account>>;
  read(account: Account, signal: AbortSignal): Promise<Result<Snapshot>>;
  consume(account: Account, creditId: string, requestId: string, signal: AbortSignal): Promise<Result<ResetOutcome>>;
}

/** Durable account transaction; pending mutation IDs must be saved before sending. */
export interface UsageStore {
  withAccount<T>(account: Account, signal: AbortSignal, run: (state: AccountState, save: (next: AccountState) => Promise<Result<void>>, lockSignal: AbortSignal) => Promise<Result<T>>): Promise<Result<T>>;
}

/** Last good data and an independent query failure can coexist. */
export interface UsageView {
  readonly provider: Provider;
  readonly account?: Account;
  readonly snapshot?: Snapshot;
  readonly error?: UsageFailure;
}

/** Reset redemption and quota refresh policy, independent of Pi and HTTP. */
export class SubscriptionUsage {
  private readonly views = new Map<Provider, UsageView>();
  private readonly revisions = new Map<Provider, number>();
  private readonly blocked = new Map<Provider, Set<string>>();
  private readonly announced = new Set<string>();
  private readonly inFlight = new Map<Provider, { readonly signal: AbortSignal; readonly promise: Promise<UsageView> }>();

  /** Wire provider clients, durable state, and deterministic clocks/IDs. */
  constructor(
    private readonly clients: Readonly<Record<Provider, SubscriptionClient>>,
    private readonly store: UsageStore,
    private readonly now: () => number,
    private readonly requestId: () => string,
  ) {}

  /** Current account snapshots; no credential is exposed. */
  getViews(): readonly UsageView[] { return [...this.views.values()]; }

  /** Warn at most once per window within one agent run. */
  beginTurn(): void { this.announced.clear(); }

  /** Runtime telemetry can update known accounts without a network call. */
  apply(provider: Provider, update: Update): string | undefined {
    const view = this.views.get(provider);
    if (!view?.snapshot) return undefined;
    this.revisions.set(provider, (this.revisions.get(provider) ?? 0) + 1);
    this.views.set(provider, { ...view, snapshot: mergeUpdate(view.snapshot, update, this.now()) });
    const blocking = update.blocking;
    if (!blocking) return undefined;
    const blocked = this.blocked.get(provider) ?? new Set<string>();
    if (blocking.rejected) blocked.add(blocking.windowId);
    else blocked.delete(blocking.windowId);
    this.blocked.set(provider, blocked);
    if (!blocking.rejected || this.announced.has(blocking.windowId)) return undefined;
    this.announced.add(blocking.windowId);
    return `${provider === "anthropic" ? "Claude" : "Codex"} reports a rejected ${blocking.windowId} window. Pi's provider retry policy is unchanged.`;
  }

  /** Current blocking evidence is tracked per window; recovery clears only its window. */
  getBlocked(provider: Provider): readonly string[] { return [...(this.blocked.get(provider) ?? [])]; }

  /** Refreshes coalesce in one process and respect shared polling/backoff deadlines. */
  async refresh(provider: Provider, signal: AbortSignal, options: { readonly fresh?: boolean } = {}): Promise<UsageView> {
    const existing = this.inFlight.get(provider);
    if (existing) {
      if (!existing.signal.aborted || signal.aborted) return existing.promise;
      // Session replacement must not reuse a cancelled read. Let it release its
      // account lock before starting the replacement session's query.
      await existing.promise;
      return this.refresh(provider, signal, options);
    }
    const pending = { signal, promise: this.refreshAccount(provider, signal, options) };
    this.inFlight.set(provider, pending);
    try { return await pending.promise; }
    finally { if (this.inFlight.get(provider) === pending) this.inFlight.delete(provider); }
  }

  private async refreshAccount(provider: Provider, signal: AbortSignal, options: { readonly fresh?: boolean }): Promise<UsageView> {
    const client = this.clients[provider];
    const discovered = await client.discover(signal);
    if (!discovered.ok) return this.publishFailure(provider, discovered.error);
    const account = discovered.value;
    // A changed login must not inherit another account's bars, warnings, or inventory.
    if (this.views.get(provider)?.account?.key !== account.key) {
      this.views.set(provider, { provider, account });
      this.blocked.delete(provider);
    }
    const revision = this.revisions.get(provider) ?? 0;
    const result = await this.store.withAccount(account, signal, async (state, save, lockSignal) => {
      const now = this.now();
      if (!this.views.get(provider)?.snapshot && state.snapshot) this.views.set(provider, { provider, account, snapshot: state.snapshot });
      if ((state.cooldownUntil ?? 0) > now) return fail(new UsageFailure("rateLimited", "The subscription endpoint is cooling down.", state.cooldownUntil));
      if ((state.nextPollAt ?? 0) > now) {
        if (state.snapshot && !options.fresh) return ok(state.snapshot);
        return fail(new UsageFailure("rateLimited", "The next account query is not due yet. Refresh does not bypass the shared cooldown.", state.nextPollAt));
      }
      const read = await client.read(account, lockSignal);
      // Shutdown/reload must not turn a cancelled read into account-wide backoff.
      if (lockSignal.aborted) return fail(new UsageFailure("cancelled", "Usage query cancelled."));
      if (!read.ok) {
        const nextPollAt = read.error.retryAt ?? now + (read.error.kind === "rateLimited" ? 15 * 60_000 : 5 * 60_000);
        const saved = await save({ ...state, nextPollAt, cooldownUntil: nextPollAt });
        return saved.ok ? read : fail<Snapshot>(saved.error);
      }
      const saved = await save({ ...state, snapshot: read.value,
        nextPollAt: Math.max(this.now() + 5 * 60_000, read.value.queryRetryAt ?? 0), cooldownUntil: read.value.queryRetryAt ?? 0 });
      return saved.ok ? read : fail<Snapshot>(saved.error);
    });
    if (signal.aborted) return { provider, account, error: new UsageFailure("cancelled", "Usage query cancelled.") };
    if (!result.ok) return this.publishFailure(provider, result.error, account);
    // A full read must not overwrite a newer passive update that landed while it ran.
    const current = this.views.get(provider)?.snapshot;
    const snapshot = current && ((this.revisions.get(provider) ?? 0) !== revision || current.checkedAt > result.value.checkedAt)
      ? { ...result.value, windows: current.windows, ...(current.notice ? { notice: current.notice } : {}) }
      : result.value;
    const view: UsageView = { provider, account, snapshot };
    this.views.set(provider, view);
    return view;
  }

  private publishFailure(provider: Provider, error: UsageFailure, account?: Account): UsageView {
    const previous = this.views.get(provider);
    const view: UsageView = {
      provider, error,
      ...(account ? { account } : {}),
      // Unknown/changed authentication is not proof we still own the old account.
      ...(account && !["auth", "accountChanged"].includes(error.kind) && previous?.account?.key === account.key && previous.snapshot ? { snapshot: previous.snapshot } : {}),
    };
    this.views.set(provider, view);
    return view;
  }

  /** Inventory menus show an interrupted claim even if its credit has disappeared. */
  async getPending(account: Account, signal: AbortSignal): Promise<Result<AccountState["pending"]>> {
    return this.store.withAccount(account, signal, async state => ok(state.pending));
  }

  /** Confirmed UI actions must supply the exact account and credit they displayed. */
  async redeem(account: Account, creditId: string, signal: AbortSignal, confirmation: { readonly count?: number } = {}): Promise<Result<ResetOutcome>> {
    const client = this.clients[account.provider];
    const discovered = await client.discover(signal);
    if (!discovered.ok) return discovered;
    if (discovered.value.key !== account.key) return fail(new UsageFailure("accountChanged", "The login changed after confirmation. Open reset inventory again."));
    const result = await this.store.withAccount(account, signal, async (state, save, lockSignal) => {
      const now = this.now();
      // A saved polling interval is not a mutation cooldown; only provider failures block redemption.
      if ((state.cooldownUntil ?? 0) > now) return fail(new UsageFailure("rateLimited", "The provider is cooling down. Try later.", state.cooldownUntil));
      if (state.pending && state.pending.creditId !== creditId) return fail(new UsageFailure("uncertain", `A previous reset is unconfirmed. Retry credit ${state.pending.creditId} first.`));
      let preparedState = state;
      if (!state.pending) {
        const fresh = await client.read(account, lockSignal);
        if (!fresh.ok) {
          const deadline = fresh.error.retryAt ?? now + 5 * 60_000;
          const saved = await save({ ...state, nextPollAt: deadline, cooldownUntil: deadline });
          return saved.ok ? fresh : saved;
        }
        const saved = await save({ ...state, snapshot: fresh.value, nextPollAt: Math.max(this.now() + 5 * 60_000, fresh.value.queryRetryAt ?? 0), cooldownUntil: fresh.value.queryRetryAt ?? 0 });
        if (!saved.ok) return saved;
        if ((fresh.value.queryRetryAt ?? 0) > this.now()) return fail(new UsageFailure("rateLimited", "Reset inventory is cooling down.", fresh.value.queryRetryAt));
        preparedState = { ...state, snapshot: fresh.value, nextPollAt: this.now() + 5 * 60_000, cooldownUntil: 0 };
        const credit = fresh.value.inventory.kind === "known" ? fresh.value.inventory.credits.find(c => c.id === creditId) : undefined;
        if (!credit || !canRedeem(credit, this.now())) return fail(new UsageFailure("invalid", "This credit is no longer usable. Refresh reset inventory."));
        if (confirmation.count !== undefined && credit.count !== confirmation.count) return fail(new UsageFailure("invalid", "Reset inventory changed after confirmation. Open it again before spending another reset."));
      }
      const pending = state.pending ?? { creditId, requestId: this.requestId() };
      const prepared: AccountState = { ...preparedState, pending };
      const saved = await save(prepared);
      if (!saved.ok) return saved;
      const consumed = await client.consume(account, creditId, pending.requestId, lockSignal);
      if (!consumed.ok) {
        const { pending: _pending, ...withoutPending } = prepared;
        const retained = consumed.error.settled ? withoutPending : prepared;
        const retryAt = consumed.error.retryAt ?? (consumed.error.kind === "rateLimited" ? this.now() + 15 * 60_000 : undefined);
        const stored = await save({ ...retained, ...(retryAt !== undefined ? { nextPollAt: retryAt, cooldownUntil: retryAt } : {}) });
        return stored.ok ? consumed : fail<ResetOutcome>(stored.error);
      }
      // Clear the key only after a definitive provider outcome. A failed read must not replay a confirmed claim.
      const { pending: _pending, ...withoutPending } = prepared;
      const cleared = await save({ ...withoutPending, nextPollAt: 0, cooldownUntil: 0 });
      if (!cleared.ok) return cleared;
      const refreshed = await client.read(account, lockSignal);
      if (refreshed.ok) {
        const persisted = await save({ ...withoutPending, snapshot: refreshed.value, nextPollAt: Math.max(this.now() + 5 * 60_000, refreshed.value.queryRetryAt ?? 0), cooldownUntil: refreshed.value.queryRetryAt ?? 0 });
        if (!persisted.ok) return persisted;
        this.views.set(account.provider, { provider: account.provider, account, snapshot: refreshed.value });
      } else {
        const deadline = refreshed.error.retryAt ?? this.now() + 5 * 60_000;
        const stored = await save({ ...withoutPending, nextPollAt: deadline, cooldownUntil: deadline });
        if (!stored.ok) return stored;
        this.publishFailure(account.provider, new UsageFailure(refreshed.error.kind, `Reset outcome: ${consumed.value}. Usage refresh failed; previous bars are stale.`, refreshed.error.retryAt), account);
      }
      return consumed;
    });
    return result;
  }
}
