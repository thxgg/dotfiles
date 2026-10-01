import { canRedeem, fail, ok, UsageFailure, type Account, type AccountState, type Inventory, type ResetCredit, type ResetOutcome, type Result, type Snapshot, type Update, type Window } from "./domain.ts";

/** Parse only objects; all their fields stay unknown until decoded. */
export function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  // SAFETY: The guard excludes primitives, null, and arrays. No field is trusted.
  return value as Record<string, unknown>;
}

/** Prevent provider labels from inserting terminal control sequences. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, 180) : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function creditBalance(value: unknown): number | undefined {
  const parsed = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : number(value);
  return parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
function count(value: unknown): number | undefined {
  const n = number(value);
  return n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}
function percent(value: unknown): number | undefined {
  const n = number(value);
  return n === undefined ? undefined : Math.max(0, Math.min(100, n));
}
function epoch(value: unknown): number | undefined {
  const n = number(value);
  return n !== undefined && n > 0 && n * 1000 <= 8.64e15 ? n * 1000 : undefined;
}
function iso(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const n = Date.parse(value);
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined ||
      month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return undefined;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function safeId(value: unknown, max = 128): string | undefined {
  return typeof value === "string" && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}
function durationLabel(mins: number): string {
  if (mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}

function codexWindows(payload: Record<string, unknown>): Window[] {
  const windows: Window[] = [];
  const plan = text(payload.plan_type ?? payload.planType);
  const map = record(payload.rateLimitsByLimitId);
  const main = record(map?.codex ?? payload.rate_limit ?? payload.rateLimits ?? payload);
  if (!main || (text(main.limitId) && main.limitId !== "codex")) return windows;
  for (const [id, raw, fallback] of [
    ["primary", main.primary_window ?? main.primary, plan === "free" || plan === "go" || main.planType === "free" || main.planType === "go" ? 43200 : 300],
    ["secondary", main.secondary_window ?? main.secondary, 10080],
  ] as const) {
    const window = record(raw);
    const used = percent(window?.used_percent ?? window?.usedPercent);
    if (!window || used === undefined) continue;
    const secs = number(window.limit_window_seconds);
    const mins = number(window.windowDurationMins);
    const durationMins = secs !== undefined && secs > 0 ? secs / 60 : mins !== undefined && mins > 0 ? mins : fallback;
    const resetsAt = epoch(window.reset_at ?? window.resetsAt);
    windows.push({ id, label: durationLabel(durationMins), usedPercent: used, durationMins,
      ...(resetsAt !== undefined ? { resetsAt } : {}) });
  }
  return windows;
}

/** Main Codex allowance only: model-specific notifications cannot replace it. */
export function parseCodexUpdate(value: unknown): Update | undefined {
  const payload = record(value);
  if (!payload) return undefined;
  const main = record(record(payload.rateLimitsByLimitId)?.codex ?? payload.rateLimits ?? payload);
  if (main?.limitId && main.limitId !== "codex") return undefined;
  const windows = codexWindows(payload).map(window => {
    const raw = record(main?.[window.id]);
    if (raw?.windowDurationMins !== undefined || raw?.limit_window_seconds !== undefined || main?.planType) return window;
    const { durationMins: _duration, ...sparse } = window;
    return sparse;
  });
  const reason = text(main?.rateLimitReachedType);
  const notice = reason?.includes("credits_depleted") ? "Workspace credits are depleted." : reason?.includes("usage_limit_reached") ? "Workspace spend limit reached." : undefined;
  return windows.length || notice ? { windows, ...(notice ? { notice } : {}) } : undefined;
}

/** Decode a full Codex usage read without inventing absent quota windows. */
export function parseCodexUsage(value: unknown, account: Account, now: number): Result<Snapshot> {
  const payload = record(value);
  if (!payload) return fail(new UsageFailure("invalid", "Codex returned an invalid usage response."));
  const windows = codexWindows(payload);
  const credits = record(payload.credits);
  const purchasedCredits = creditBalance(credits?.balance);
  const reason = text(payload.rateLimitReachedType ?? record(payload.rate_limit)?.rate_limit_reached_type);
  const spendCap = record(payload.spend_control)?.reached === true;
  const notice = spendCap ? "Workspace spend cap reached." :
    reason?.includes("credits_depleted") ? "Workspace credits are depleted." :
    reason?.includes("usage_limit_reached") ? "Workspace spend limit reached." : undefined;
  if (!windows.length && !credits && !spendCap) return fail(new UsageFailure("invalid", "Codex returned no usable quota windows."));
  const plan = text(payload.plan_type ?? record(payload.rateLimits)?.planType);
  return ok({ account, checkedAt: now, windows, inventory: { kind: "unavailable", message: "Reset inventory has not been read." },
    ...(plan ? { plan } : {}), ...(purchasedCredits !== undefined ? { purchasedCredits } : {}),
    ...(notice ? { notice } : {}), ...(reason ? { limitReason: reason } : {}) });
}

/** Decode Codex inventory; unknown reset types are visible but not redeemable. */
export function parseCodexInventory(value: unknown, now: number): Result<Inventory> {
  const payload = record(value);
  if (!payload || !Array.isArray(payload.credits)) return fail(new UsageFailure("invalid", "Codex returned an invalid reset inventory."));
  const credits: ResetCredit[] = [];
  for (const raw of payload.credits) {
    const credit = record(raw);
    const id = safeId(credit?.id);
    if (!credit || !id) continue;
    const rawExpiry = credit.expires_at ?? credit.expiresAt;
    const expiresAt = typeof rawExpiry === "number" ? epoch(rawExpiry) : iso(rawExpiry);
    const status = credit.status;
    const resetType = credit.reset_type ?? credit.resetType;
    const knownType = resetType === "codex_rate_limits";
    const parsedStatus = status === "redeemed" ? "redeemed" : rawExpiry != null && expiresAt === undefined ? "unknown" :
      expiresAt !== undefined && expiresAt <= now ? "expired" : !knownType ? "unknown" :
      status === "available" && expiresAt !== undefined ? "available" : "unavailable";
    credits.push({ id, count: 1, status: parsedStatus,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(!knownType ? { detail: "Unknown reset type; redemption disabled." } : {}) });
  }
  return ok({ kind: "known", credits });
}

function claudeWindow(id: string, label: string, raw: unknown, fraction = false): Window | undefined {
  const window = record(raw);
  const n = number(window?.utilization ?? window?.percent);
  if (!window || n === undefined) return undefined;
  const usedPercent = Math.max(0, Math.min(100, fraction ? n * 100 : n));
  const resetsAt = iso(window.resets_at);
  return { id, label, usedPercent, durationMins: id === "five_hour" ? 300 : 10080,
    ...(resetsAt !== undefined ? { resetsAt } : {}) };
}
function scopedId(name: string): string {
  return `seven_day_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

/** Decode current dynamic Claude buckets and older model-specific usage shapes. */
export function parseAnthropicUsage(value: unknown, account: Account, now: number): Result<Snapshot> {
  const payload = record(value);
  if (!payload) return fail(new UsageFailure("invalid", "Claude returned an invalid usage response."));
  const limits = record(payload.rate_limits) ?? payload;
  const windows = new Map<string, Window>();
  for (const [id, label] of [["five_hour", "5h"], ["seven_day", "7d"]] as const) {
    const window = claudeWindow(id, label, limits[id]);
    if (window) windows.set(id, window);
  }
  const scoped = Array.isArray(limits.model_scoped) ? limits.model_scoped : [];
  for (const raw of scoped) {
    const entry = record(raw);
    const name = text(entry?.display_name);
    if (!name) continue;
    const id = scopedId(name);
    const window = claudeWindow(id, `7d · ${name}`, raw);
    if (window) windows.set(id, window);
  }
  for (const raw of Array.isArray(payload.limits) ? payload.limits : []) {
    const entry = record(raw);
    const name = text(record(record(entry?.scope)?.model)?.display_name);
    if (entry?.kind !== "weekly_scoped" || !name) continue;
    const id = scopedId(name);
    const window = claudeWindow(id, `7d · ${name}`, entry);
    if (window) windows.set(id, window);
  }
  for (const [id, label] of [["seven_day_sonnet", "7d · Sonnet"], ["seven_day_omelette", "7d · Opus"], ["seven_day_opus", "7d · Opus (legacy)"]] as const) {
    const window = claudeWindow(id, label, limits[id]);
    if (window) windows.set(id, window);
  }
  const extra = record(payload.extra_usage);
  const used = number(extra?.used_credits);
  const limit = number(extra?.monthly_limit);
  const currency = text(extra?.currency) ?? "USD";
  const notice = extra?.is_enabled === true
    ? `Paid overage enabled${used !== undefined ? `: ${currency} ${(used / 100).toFixed(2)}${limit !== undefined ? ` / ${(limit / 100).toFixed(2)}` : ""}` : ""}. A full base window need not block requests.`
    : undefined;
  if (!windows.size && payload.rate_limits_available !== false) return fail(new UsageFailure("invalid", "Claude returned no usable quota windows."));
  const inventory = parseAnthropicInventory(payload.cedar_ember, now);
  return ok({ account, checkedAt: now, windows: [...windows.values()], inventory,
    ...(notice ? { notice } : {}) });
}

/** Claude grants require eligibility, usable_now, a valid expiry, and a positive count. */
export function parseAnthropicInventory(value: unknown, now: number): Inventory {
  const block = record(value);
  if (!block || typeof block.eligible !== "boolean") return { kind: "unavailable", message: "Claude did not report reset inventory." };
  const credits: ResetCredit[] = [];
  for (const raw of Array.isArray(block.grants) ? block.grants : []) {
    const grant = record(raw);
    const rawId = grant?.id;
    const id = typeof rawId === "string" && /^[a-z0-9_-]{1,40}$/.test(rawId) ? rawId : undefined;
    const remaining = count(grant?.resets_left);
    if (!grant || !id || remaining === undefined || (grant.paused !== undefined && typeof grant.paused !== "boolean")) continue;
    const expiresAt = iso(grant.ends_at);
    const status = grant.ends_at != null && expiresAt === undefined ? "unknown" :
      expiresAt !== undefined && expiresAt <= now ? "expired" :
      grant.paused === true ? "paused" : !block.eligible || grant.usable_now !== true ? "unavailable" :
      remaining === 0 ? "redeemed" : "available";
    credits.push({ id, count: remaining, status, ...(expiresAt !== undefined ? { expiresAt } : {}) });
  }
  return { kind: "known", credits };
}

/** Convert SDK-style Claude fractions explicitly, including allowed overage. */
export function parseAnthropicEvent(value: unknown, previous: Snapshot | undefined): Update | undefined {
  const message = record(value);
  const info = record(message?.rate_limit_info);
  if (message?.type !== "rate_limit_event" || !info) return undefined;
  const type = text(info.rateLimitType);
  let id = type;
  if (type === "seven_day_overage_included") id = previous?.windows.find(w => w.id.startsWith("seven_day_") && !["seven_day_sonnet", "seven_day_opus", "seven_day_omelette"].includes(w.id))?.id;
  if (!id || !["five_hour", "seven_day", "seven_day_overage_included"].includes(type ?? "")) return undefined;
  const overage = info.overageStatus === "allowed" || info.overageStatus === "allowed_warning" || info.isUsingOverage === true || info.overageInUse === true;
  const rejected = info.status === "rejected" && !overage;
  const recovered = info.status === "allowed" || info.status === "allowed_warning" || overage;
  const used = number(info.utilization);
  const resetsAt = epoch(info.resetsAt);
  const old = previous?.windows.find(w => w.id === id);
  const windows: Window[] = used === undefined ? [] : [{ id, label: old?.label ?? (id === "five_hour" ? "5h" : "7d"),
    usedPercent: Math.max(0, Math.min(100, used * 100)),
    ...(resetsAt !== undefined ? { resetsAt } : {}) }];
  return { windows,
    ...(rejected || recovered ? { blocking: { windowId: id, rejected } } : {}),
    ...(overage ? { notice: "Paid overage is carrying this request despite the base limit." } : {}) };
}

/** Decode response headers without treating an endpoint 429 as an empty allowance. */
export function parseUsageHeaders(provider: "codex" | "anthropic", headers: Record<string, string>, now: number): Update | undefined {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const windows: Window[] = [];
  for (const [id, prefix, fallback] of provider === "codex"
    ? [["primary", "x-codex-primary", 300], ["secondary", "x-codex-secondary", 10080]] as const
    : [["five_hour", "anthropic-ratelimit-unified-5h", 300], ["seven_day", "anthropic-ratelimit-unified-7d", 10080]] as const) {
    const value = lower.get(`${prefix}-${provider === "codex" ? "used-percent" : "utilization"}`);
    const n = value !== undefined && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n)) continue;
    const duration = Number(lower.get(`${prefix}-window-minutes`));
    const durationMins = Number.isFinite(duration) && duration > 0 ? duration : fallback;
    const rawReset = lower.get(`${prefix}-${provider === "codex" ? "reset-at" : "reset"}`);
    const rawAfter = lower.get(`${prefix}-reset-after-seconds`);
    const resetsAt = rawReset ? epoch(Number(rawReset)) ?? iso(rawReset) :
      rawAfter && Number.isFinite(Number(rawAfter)) && Number(rawAfter) > 0 ? now + Number(rawAfter) * 1000 : undefined;
    windows.push({ id, label: durationLabel(durationMins),
      ...(Number.isFinite(duration) && duration > 0 ? { durationMins } : {}),
      usedPercent: Math.max(0, Math.min(100, provider === "anthropic" ? n * 100 : n)),
      ...(resetsAt !== undefined ? { resetsAt } : {}) });
  }
  if (provider === "anthropic") {
    const status = lower.get("anthropic-ratelimit-unified-status");
    const claim = lower.get("anthropic-ratelimit-unified-representative-claim");
    const overageStatus = lower.get("anthropic-ratelimit-unified-overage-status");
    const overage = overageStatus === "allowed" || overageStatus === "allowed_warning" || lower.get("anthropic-ratelimit-unified-is-using-overage") === "true";
    const windowId = claim === "five_hour" || claim === "seven_day" ? claim : undefined;
    const rejected = status === "rejected" && !overage;
    const recovered = status === "allowed" || status === "allowed_warning" || overage;
    if (windows.length || windowId && (rejected || recovered)) return { windows,
      ...(windowId && (rejected || recovered) ? { blocking: { windowId, rejected } } : {}),
      ...(overage ? { notice: "Paid overage is carrying this request despite the base limit." } : {}) };
  }
  return windows.length ? { windows } : undefined;
}

/** Only an explicit response outcome confirms a reset mutation. */
export function parseResetOutcome(provider: "codex" | "anthropic", value: unknown): Result<ResetOutcome> {
  const payload = record(value);
  const code = provider === "codex" ? payload?.code ?? payload?.outcome : payload?.result;
  switch (code) {
    case "reset": return ok("reset");
    case "already_redeemed": case "already_used": case "alreadyRedeemed": return ok("alreadyRedeemed");
    case "nothing_to_reset": case "not_limited": case "nothingToReset": return ok("nothingToReset");
    case "no_credit": case "ineligible": case "noCredit": return ok("noCredit");
    case "cooldown": return fail(new UsageFailure("rateLimited", "Reset credits are cooling down. Try later.", undefined, true));
    default: return fail(new UsageFailure("uncertain", "The provider did not confirm the reset. Retry the same credit to reuse its request ID."));
  }
}

/** Decode our own persisted account state before using it. */
export function parseAccountState(value: unknown, account: Account): Result<AccountState> {
  const state = record(value);
  if (!state || state.version !== 1) return fail(new UsageFailure("storage", "Usage state has an unsupported format."));
  const pendingRaw = record(state.pending);
  const creditId = safeId(pendingRaw?.creditId);
  const requestId = safeId(pendingRaw?.requestId);
  if (state.pending !== undefined && (!creditId || !requestId)) return fail(new UsageFailure("storage", "Reset idempotency state is invalid; redemption is disabled."));
  const snapshotRaw = record(state.snapshot);
  let snapshot: Snapshot | undefined;
  if (snapshotRaw) {
    const savedAccount = record(snapshotRaw.account);
    const checkedAt = number(snapshotRaw.checkedAt);
    const windows: Window[] = [];
    if (savedAccount?.key !== account.key || checkedAt === undefined || !Array.isArray(snapshotRaw.windows)) return fail(new UsageFailure("storage", "Usage state does not match this account."));
    for (const raw of snapshotRaw.windows) {
      const w = record(raw);
      const id = text(w?.id), label = text(w?.label), used = percent(w?.usedPercent);
      if (!w || !id || !label || used === undefined) return fail(new UsageFailure("storage", "Cached usage windows are invalid."));
      const resetsAt = number(w.resetsAt), durationMins = number(w.durationMins), detail = text(w.detail);
      windows.push({ id, label, usedPercent: used, ...(resetsAt !== undefined ? { resetsAt } : {}),
        ...(durationMins !== undefined ? { durationMins } : {}), ...(detail ? { detail } : {}) });
    }
    // Cached inventories are never authority for mutations. Every redemption re-reads them.
    const plan = text(snapshotRaw.plan), oldNotice = text(snapshotRaw.notice);
    // Read older caches without discarding their balance or bypassing the poll deadline.
    const legacyBalance = oldNotice?.startsWith("Purchased credits: ") ? oldNotice.slice("Purchased credits: ".length) : undefined;
    const purchasedCredits = creditBalance(snapshotRaw.purchasedCredits ?? legacyBalance);
    const notice = legacyBalance !== undefined ? undefined : oldNotice;
    const cachedInventory = record(snapshotRaw.inventory);
    const cachedCredits: ResetCredit[] = [];
    for (const raw of Array.isArray(cachedInventory?.credits) ? cachedInventory.credits : []) {
      const c = record(raw);
      const id = safeId(c?.id), remaining = count(c?.count), expiresAt = number(c?.expiresAt);
      const status = c?.status;
      if (!id || remaining === undefined || !["available", "expired", "paused", "unavailable", "redeemed", "unknown"].includes(String(status))) continue;
      // SAFETY: The explicit list above contains every member of ResetCredit.status.
      const parsedStatus = status as ResetCredit["status"];
      cachedCredits.push({ id, count: remaining, status: parsedStatus, ...(expiresAt !== undefined ? { expiresAt } : {}) });
    }
    snapshot = { account, checkedAt, windows,
      inventory: cachedInventory?.kind === "known" ? { kind: "known", credits: cachedCredits } :
        { kind: "unavailable", message: text(cachedInventory?.message) ?? "Refresh to read reset inventory." },
      ...(plan ? { plan } : {}), ...(purchasedCredits !== undefined ? { purchasedCredits } : {}), ...(notice ? { notice } : {}) };
  }
  const nextPollAt = number(state.nextPollAt), cooldownUntil = number(state.cooldownUntil);
  return ok({ ...(snapshot ? { snapshot } : {}), ...(nextPollAt !== undefined ? { nextPollAt } : {}),
    ...(cooldownUntil !== undefined ? { cooldownUntil } : {}),
    ...(creditId && requestId ? { pending: { creditId, requestId } } : {}) });
}

/** Sum only credits that are usable now. */
export function availableResets(inventory: Inventory, now: number): number {
  return inventory.kind === "known" ? inventory.credits.filter(c => canRedeem(c, now)).reduce((n, c) => n + c.count, 0) : 0;
}
