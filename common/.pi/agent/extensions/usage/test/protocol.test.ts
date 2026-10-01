import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeUpdate, canRedeem, type Account, type Snapshot } from "../domain.ts";
import { parseAnthropicUsage, parseAnthropicInventory, parseAnthropicEvent, parseCodexUsage, parseCodexUpdate, parseCodexInventory, parseUsageHeaders, parseResetOutcome, parseAccountState } from "../protocol.ts";
import { accountKey } from "../providers.ts";
import { retryDeadline } from "../http.ts";

const now = Date.parse("2026-10-01T00:00:00Z");
const account: Account = { provider: "codex", key: accountKey("codex", "test"), label: "Synthetic Codex" };
const claude: Account = { provider: "anthropic", key: accountKey("anthropic", "test"), label: "Synthetic Claude" };
const next = "2026-10-02T00:00:00Z";

function snapshot(value: unknown, provider = "codex"): Snapshot {
  const result = provider === "codex" ? parseCodexUsage(value, account, now) : parseAnthropicUsage(value, claude, now);
  if (!result.ok) throw result.error;
  assert.equal(result.ok, true);
  return result.value;
}

test("Codex primary uses actual duration, monthly plan fallback, and main bucket", () => {
  const weekly = snapshot({ rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 604800 } } });
  assert.equal(weekly.windows[0]?.label, "7d");
  assert.equal(weekly.windows[0]?.usedPercent, 42);
  assert.equal(snapshot({ plan_type: "free", rate_limit: { primary_window: { used_percent: 10 } } }).windows[0]?.label, "30d");
  assert.equal(snapshot({ rateLimits: { limitId: "spark", primary: { usedPercent: 99 } }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 7, windowDurationMins: 10080 } } } }).windows[0]?.usedPercent, 7);
  assert.equal(parseCodexUpdate({ limitId: "spark", primary: { usedPercent: 99 } }), undefined);
});

test("Codex sparse updates preserve secondary and primary reset/duration", () => {
  const previous = snapshot({ rateLimits: { primary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: now / 1000 + 100 }, secondary: { usedPercent: 20 } } });
  const update = parseCodexUpdate({ primary: { usedPercent: 44 } });
  assert.ok(update);
  const merged = mergeUpdate(previous, update, now + 1);
  assert.equal(merged.windows.length, 2);
  assert.equal(merged.windows[0]?.label, "7d");
  assert.equal(merged.windows[0]?.resetsAt, now + 100_000);
  assert.equal(merged.windows[1]?.usedPercent, 20);
  assert.match(parseCodexUpdate({ rateLimitReachedType: "workspace_owner_credits_depleted" })?.notice ?? "", /depleted/);
});

test("Codex workspace credit and spend failures remain distinct", () => {
  assert.equal(snapshot({ credits: { has_credits: true, balance: "8.50" } }).purchasedCredits, 8.5);
  assert.match(snapshot({ spend_control: { reached: true } }).notice ?? "", /spend cap/);
  assert.equal(parseCodexUsage({ error: "unauthorized" }, account, now).ok, false);
});

test("credit balances are parsed at the boundary and retained through old and new caches", () => {
  for (const balance of ["62500", 62500, "0", 0]) {
    const parsed = snapshot({ credits: { balance } });
    assert.equal(parsed.purchasedCredits, Number(balance));
    const restored = parseAccountState({ version: 1, snapshot: parsed }, account);
    assert.ok(restored.ok);
    assert.equal(restored.value.snapshot?.purchasedCredits, Number(balance));
  }
  for (const balance of ["", "oops", "1e3", "-1", -1, Infinity, null, {}]) {
    assert.equal(snapshot({ credits: { balance } }).purchasedCredits, undefined);
  }
  const old = snapshot({ rate_limit: { primary_window: { used_percent: 14 } } });
  const restored = parseAccountState({ version: 1, snapshot: { ...old, notice: "Purchased credits: 62500" } }, account);
  assert.ok(restored.ok);
  assert.equal(restored.value.snapshot?.purchasedCredits, 62500);
  assert.equal(restored.value.snapshot?.notice, undefined);
  const depleted = snapshot({ credits: { balance: "0" }, rateLimitReachedType: "workspace_owner_credits_depleted" });
  assert.equal(depleted.purchasedCredits, 0);
  assert.match(depleted.notice ?? "", /depleted/);
});

test("Claude usage percentages are never guessed from their magnitude", () => {
  for (const used of [0, 0.5, 1, 42, 100]) {
    const usage = snapshot({ five_hour: { utilization: used, resets_at: next } }, "anthropic");
    assert.equal(usage.windows[0]?.usedPercent, used);
    assert.equal(usage.windows[0]?.resetsAt, Date.parse(next));
  }
});

test("Claude dynamic SDK and raw scoped buckets keep names and overage cents", () => {
  const usage = snapshot({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 100 }, model_scoped: [{ display_name: "Fable", utilization: 15, resets_at: next }] }, extra_usage: { is_enabled: true, used_credits: 123, monthly_limit: 1000 } }, "anthropic");
  assert.deepEqual(usage.windows.map(w => w.id), ["five_hour", "seven_day_fable"]);
  assert.match(usage.notice ?? "", /USD 1.23 \/ 10.00/);
  const raw = snapshot({ limits: [{ kind: "weekly_scoped", scope: { model: { display_name: "Future Model" } }, utilization: 0.5 }] }, "anthropic");
  assert.equal(raw.windows[0]?.label, "7d · Future Model");
  const update = parseAnthropicEvent({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "seven_day_overage_included", utilization: 0.5, resetsAt: now / 1000 + 120, status: "rejected", overageStatus: "allowed" } }, usage);
  assert.equal(update?.windows[0]?.id, "seven_day_fable");
  assert.equal(update?.windows[0]?.usedPercent, 50);
  assert.equal(update?.blocking?.rejected, false);
  assert.equal(parseAnthropicEvent({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "seven_day_overage_included", utilization: 0.5 } }, undefined), undefined);
});

test("Claude rejected base windows recover when any overage indicator permits", () => {
  for (const overage of [{ overageStatus: "allowed" }, { overageStatus: "allowed_warning" }, { isUsingOverage: true }, { overageInUse: true }]) {
    const update = parseAnthropicEvent({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", status: "rejected", ...overage } }, undefined);
    assert.equal(update?.blocking?.rejected, false);
  }
  assert.equal(parseAnthropicEvent({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", status: "rejected" } }, undefined)?.blocking?.rejected, true);
  assert.equal(parseAnthropicEvent({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "unknown", utilization: 1 } }, undefined), undefined);
});

test("Codex reset inventory requires known type, availability, and valid future expiry", () => {
  const result = parseCodexInventory({ credits: [
    { id: "valid", status: "available", reset_type: "codex_rate_limits", expires_at: next },
    { id: "expired", status: "available", reset_type: "codex_rate_limits", expires_at: "2026-01-01T00:00:00Z" },
    { id: "bad_date", status: "available", reset_type: "codex_rate_limits", expires_at: "2027-02-30T00:00:00Z" },
    { id: "unknown_type", status: "available", reset_type: "other", expires_at: next },
    { id: "missing_expiry", status: "available", reset_type: "codex_rate_limits" },
  ] }, now);
  assert.ok(result.ok && result.value.kind === "known");
  assert.deepEqual(result.value.credits.filter(c => canRedeem(c, now)).map(c => c.id), ["valid"]);
  assert.equal(parseCodexInventory({}, now).ok, false);
});

test("Claude grant eligibility, count, pause, expiry, and malformed IDs fail closed", () => {
  const inventory = parseAnthropicInventory({ eligible: true, grants: [
    { id: "ready", resets_left: 2, usable_now: true, ends_at: next },
    { id: "no_end", resets_left: 1, usable_now: true },
    { id: "paused", resets_left: 4, usable_now: true, paused: true },
    { id: "expired", resets_left: 3, usable_now: true, ends_at: "2026-01-01T00:00:00Z" },
    { id: "bad_date", resets_left: 3, usable_now: true, ends_at: "2027-02-30T00:00:00Z" },
    { id: "Uppercase", resets_left: 1, usable_now: true },
    { id: "fraction", resets_left: 0.5, usable_now: true },
  ] }, now);
  assert.equal(inventory.kind, "known");
  if (inventory.kind !== "known") return;
  assert.deepEqual(inventory.credits.filter(c => canRedeem(c, now)).map(c => c.id), ["ready", "no_end"]);
  assert.equal(canRedeem(inventory.credits[0] ?? { id: "", count: 0, status: "unknown" }, Date.parse(next)), false);
  assert.equal(parseAnthropicInventory(null, now).kind, "unavailable");
});

test("passive headers use explicit fractions and preserve actual durations", () => {
  const codex = parseUsageHeaders("codex", { "X-Codex-Primary-Used-Percent": "0.5", "x-codex-primary-window-minutes": "10080", "x-codex-primary-reset-after-seconds": "120" }, now);
  assert.equal(codex?.windows[0]?.usedPercent, 0.5);
  assert.equal(codex?.windows[0]?.label, "7d");
  assert.equal(codex?.windows[0]?.resetsAt, now + 120_000);
  const claude = parseUsageHeaders("anthropic", { "anthropic-ratelimit-unified-5h-utilization": "0.005" }, now);
  assert.equal(claude?.windows[0]?.usedPercent, 0.5);
  assert.equal(parseUsageHeaders("codex", {}, now), undefined);
});

test("Claude response rejection and overage recovery do not guess from HTTP 429", () => {
  const rejected = parseUsageHeaders("anthropic", { "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-representative-claim": "five_hour" }, now);
  assert.equal(rejected?.blocking?.rejected, true);
  const overage = parseUsageHeaders("anthropic", { "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-representative-claim": "five_hour", "anthropic-ratelimit-unified-overage-status": "allowed" }, now);
  assert.equal(overage?.blocking?.rejected, false);
  assert.match(overage?.notice ?? "", /overage/);
  assert.equal(parseUsageHeaders("anthropic", { "retry-after": "120" }, now), undefined);
});

test("Retry-After seconds and dates have bounded deadlines", () => {
  assert.equal(retryDeadline("120", now), now + 120_000);
  assert.equal(retryDeadline(new Date(now + 240_000).toUTCString(), now), now + 240_000);
  assert.equal(retryDeadline(null, now), now + 900_000);
  assert.equal(retryDeadline("0", now), now + 30_000);
  assert.equal(retryDeadline("9999999", now), now + 3_600_000);
});

test("reset outcomes require explicit success, not HTTP success or an unknown body", () => {
  assert.deepEqual(parseResetOutcome("codex", { code: "reset" }), { ok: true, value: "reset" });
  assert.deepEqual(parseResetOutcome("anthropic", { result: "already_used" }), { ok: true, value: "alreadyRedeemed" });
  assert.equal(parseResetOutcome("anthropic", { result: "unavailable" }).ok, false);
  const cooldown = parseResetOutcome("anthropic", { result: "cooldown" });
  assert.ok(!cooldown.ok && cooldown.error.settled);
  assert.equal(parseResetOutcome("codex", {}).ok, false);
});

test("persisted account state rejects damaged pending IDs and foreign accounts", () => {
  assert.equal(parseAccountState({ version: 1, pending: { creditId: "../escape", requestId: "ok" } }, account).ok, false);
  assert.equal(parseAccountState({ version: 2 }, account).ok, false);
  const saved = snapshot({ rate_limit: { primary_window: { used_percent: 10 } } });
  assert.equal(parseAccountState({ version: 1, snapshot: saved }, claude).ok, false);
  const roundtrip = parseAccountState({ version: 1, snapshot: saved, cooldownUntil: now + 120_000 }, account);
  assert.ok(roundtrip.ok);
  assert.equal(roundtrip.value.cooldownUntil, now + 120_000);
});
