import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { inspect } from "node:util";
import { QuotaHttp, Secret } from "../http.ts";
import { ProviderQuotaClient } from "../providers.ts";
import { SubscriptionUsage } from "../service.ts";
import { FileUsageStore } from "../store.ts";
import { UsageMenu, renderStatus, type UsageUI } from "../menu.ts";
import { ok, fail, UsageFailure, type Provider, type Result, type Account } from "../domain.ts";

const now = Date.parse("2026-10-01T00:00:00Z");
const tomorrow = "2026-10-02T00:00:00Z";
const signal = () => new AbortController().signal;
const jwt = (subject: string, accountId: string) => `synthetic.${Buffer.from(JSON.stringify({ sub: subject, "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.signature`;
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

async function setup(t: { after: (callback: () => Promise<void>) => void }, provider: Provider = "codex") {
  const directory = await mkdtemp(join(tmpdir(), "pi-usage-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = now;
  let subject = "user1", accountId = "account1";
  let authResult: Result<Secret> | undefined;
  let usageFailure: Response | undefined;
  let inventoryFailure: Response | undefined;
  let consumeFailure: "lost" | "unknown" | "cooldown" | "429" | undefined;
  let left = 2;
  const requests: { readonly url: string; readonly method: string; readonly headers: Headers; readonly body: unknown; readonly redirect?: RequestInit["redirect"] }[] = [];
  const claims = new Map<string, unknown>();
  const tokens: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, headers, method: init?.method ?? "GET", body, ...(init?.redirect ? { redirect: init.redirect } : {}) });
    if (url.endsWith("/profile")) return json({ account: { uuid: subject }, organization: { uuid: accountId, name: "Synthetic organization" } });
    if (url.includes("/consume") || url.includes("/reset_rate_limits")) {
      if (consumeFailure === "lost") throw new Error("Synthetic lost response");
      if (consumeFailure === "unknown") return json({});
      if (consumeFailure === "429") return json({ error: "not model exhaustion" }, 429, { "retry-after": "120" });
      if (consumeFailure === "cooldown") return json({ result: "cooldown" });
      const raw = body !== null && typeof body === "object" ? body : {};
      const key = JSON.stringify(raw);
      const outcome = claims.has(key) ? "alreadyRedeemed" : left > 0 ? "reset" : "noCredit";
      if (outcome === "reset") { left--; claims.set(key, raw); }
      return provider === "codex" ? json({ code: outcome === "alreadyRedeemed" ? "already_redeemed" : outcome === "noCredit" ? "no_credit" : "reset" }) : json({ result: outcome === "alreadyRedeemed" ? "already_used" : outcome === "noCredit" ? "ineligible" : "reset" });
    }
    if (url.endsWith("/rate-limit-reset-credits")) return inventoryFailure?.clone() ?? json({ credits: [
      { id: "credit1", status: left > 0 ? "available" : "redeemed", reset_type: "codex_rate_limits", expires_at: tomorrow },
      { id: "credit2", status: "available", reset_type: "codex_rate_limits", expires_at: tomorrow },
    ] });
    return usageFailure?.clone() ?? (provider === "codex"
      ? json({ plan_type: "pro", rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 604800, reset_at: (clock + 120_000) / 1000 } } })
      : json({ five_hour: { utilization: 0.5, resets_at: tomorrow }, cedar_ember: { eligible: true, next_grant_id: "grant1", grants: [{ id: "grant1", resets_left: left, usable_now: left > 0, ends_at: tomorrow }] } }));
  };
  const auth = { resolve: async () => {
    const token = provider === "codex" ? jwt(subject, accountId) : `synthetic-claude-${subject}-${accountId}`;
    tokens.push(token);
    return authResult ?? ok(new Secret(token));
  } };
  const http = new QuotaHttp(fetcher, () => clock);
  const client = new ProviderQuotaClient(provider, auth, http, () => clock);
  const unavailable = { discover: async () => fail<Account>(new UsageFailure("unsupported", "Synthetic unsupported provider")), read: client.read.bind(client), consume: client.consume.bind(client) };
  const clients = provider === "codex" ? { codex: client, anthropic: unavailable } : { codex: unavailable, anthropic: client };
  const store = new FileUsageStore(directory);
  let ids = 0;
  const service = () => new SubscriptionUsage(clients, new FileUsageStore(directory), () => clock, () => `request_${++ids}`);
  const usage = service();
  return {
    directory, requests, claims, tokens, usage, service, store, client, http,
    advance: (ms: number) => { clock += ms; },
    login: (user: string, account: string) => { subject = user; accountId = account; },
    authError: () => { authResult = fail(new UsageFailure("auth", "Synthetic logout")); },
    usageError: (response?: Response) => { usageFailure = response; },
    inventoryError: (response?: Response) => { inventoryFailure = response; },
    consumeError: (error?: typeof consumeFailure) => { consumeFailure = error; },
    now: () => clock,
  };
}

async function account(client: ProviderQuotaClient): Promise<Account> {
  const result = await client.discover(signal());
  assert.ok(result.ok);
  return result.value;
}

test("metadata reads are origin-bound, read-only, beta-authenticated, and contain no model payload", async t => {
  for (const provider of ["codex", "anthropic"] as const) {
    const s = await setup(t, provider);
    const view = await s.usage.refresh(provider, signal());
    assert.ok(view.snapshot);
    if (provider === "codex") assert.equal(view.account?.accountId, "account1");
    else assert.equal(view.account?.organizationName, "Synthetic organization");
    assert.ok(s.requests.length >= 2);
    assert.ok(s.requests.every(r => r.method === "GET" && r.body === undefined && r.redirect === "error"));
    assert.ok(s.requests.every(r => r.url.startsWith(provider === "codex" ? "https://chatgpt.com/" : "https://api.anthropic.com/")));
    if (provider === "anthropic") assert.ok(s.requests.every(r => r.headers.get("anthropic-beta") === "oauth-2025-04-20"));
    else assert.ok(s.requests.every(r => r.headers.get("ChatGPT-Account-ID") === "account1"));
    const files = await readdir(s.directory);
    const saved = await readFile(join(s.directory, files.find(f => f.endsWith(".json")) ?? "missing"), "utf8");
    assert.ok(s.tokens.every(token => !saved.includes(token)));
    assert.equal((await stat(join(s.directory, files.find(f => f.endsWith(".json")) ?? "missing"))).mode & 0o777, 0o600);
  }
});

test("concurrent sessions share query cache and manual refresh never bypasses TTL", async t => {
  const s = await setup(t);
  const another = s.service();
  await Promise.all([s.usage.refresh("codex", signal()), another.refresh("codex", signal())]);
  assert.equal(s.requests.filter(r => r.url.endsWith("/usage")).length, 1);
  await Promise.all([s.usage.refresh("codex", signal()), s.usage.refresh("codex", signal())]);
  assert.equal(s.requests.filter(r => r.url.endsWith("/usage")).length, 1);
  assert.equal(another.getViews()[0]?.snapshot?.inventory.kind, "known");
});

test("429 retains stale bars, shares Retry-After, and triggers no fallback calls", async t => {
  const s = await setup(t);
  await s.usage.refresh("codex", signal());
  s.advance(300_001);
  s.usageError(json({ error: "synthetic" }, 429, { "retry-after": "120" }));
  const failed = await s.usage.refresh("codex", signal());
  assert.equal(failed.snapshot?.windows[0]?.usedPercent, 42);
  assert.equal(failed.error?.kind, "rateLimited");
  const count = s.requests.length;
  await s.usage.refresh("codex", signal());
  assert.equal(s.requests.length, count);
  const second = s.service();
  const stale = await second.refresh("codex", signal());
  assert.equal(stale.error?.kind, "rateLimited");
  assert.equal(stale.snapshot?.windows[0]?.usedPercent, 42);
  assert.equal(s.requests.length, count);
  s.advance(120_001);
  s.usageError();
  const recovered = await second.refresh("codex", signal());
  assert.ok(recovered.snapshot && !recovered.error);
});

test("optional inventory 429 preserves usage and extends shared backoff", async t => {
  const s = await setup(t);
  s.inventoryError(json({}, 429, { "retry-after": "1200" }));
  const view = await s.usage.refresh("codex", signal());
  assert.equal(view.snapshot?.windows[0]?.usedPercent, 42);
  assert.equal(view.snapshot?.inventory.kind, "unavailable");
  s.advance(300_001);
  const count = s.requests.length;
  const result = await s.usage.redeem(await account(s.client), "credit1", signal());
  assert.ok(!result.ok && result.error.kind === "rateLimited");
  await s.usage.refresh("codex", signal());
  assert.equal(s.requests.length, count);
});

test("account change and logout never keep another account's windows", async t => {
  const s = await setup(t);
  await s.usage.refresh("codex", signal());
  const previous = s.usage.getViews()[0]?.account;
  assert.ok(previous);
  s.login("user2", "account2");
  s.usageError(json({}, 401));
  const changed = await s.usage.refresh("codex", signal());
  assert.notEqual(changed.account?.key, previous.key);
  assert.equal(changed.snapshot, undefined);
  const result = await s.usage.redeem(previous, "credit1", signal());
  assert.ok(!result.ok && result.error.kind === "accountChanged");
  s.authError();
  const logout = await s.usage.refresh("codex", signal());
  assert.equal(logout.account, undefined);
  assert.equal(logout.snapshot, undefined);
});

test("reset menus require confirmation; cancel and non-UI paths cannot mutate", async t => {
  const s = await setup(t);
  const menu = new UsageMenu(s.usage, s.now);
  const prompts: string[] = [];
  const ui: UsageUI = {
    hasUI: true,
    select: async (title, choices, labels) => {
      prompts.push(title);
      if (title.startsWith("OpenAI Reset Redeem")) return "No";
      return choices.find(c => c.startsWith("reset:")) ?? choices.find(c => c.startsWith("Legacy Codex"));
    },
    confirm: async () => { throw new Error("OpenAI uses the Yes/No selector."); },
    notify: () => undefined,
  };
  await menu.inventory(ui, signal());
  assert.ok(prompts.some(p => p.includes("Are you sure you want to redeem this banked reset that expires in 1d?")));
  assert.equal(s.requests.filter(r => r.method === "POST").length, 0);
  await menu.inventory({ ...ui, hasUI: false, confirm: async () => true }, signal());
  assert.equal(s.requests.filter(r => r.method === "POST").length, 0);
});

test("equal OpenAI expiry labels still redeem the exact selected credit after confirmation", async t => {
  const s = await setup(t);
  const titles: string[] = [];
  const ui: UsageUI = {
    hasUI: true,
    select: async (title, choices, labels) => {
      titles.push(title);
      if (title === "OpenAI Resets") {
        assert.deepEqual(labels, ["Reset · expires in 1d", "Reset · expires in 1d", "Back"]);
        return choices[1];
      }
      if (title.startsWith("OpenAI Reset Redeem")) {
        assert.deepEqual(choices, ["Yes", "No"]);
        assert.equal(s.requests.filter(r => r.method === "POST").length, 0);
        return "Yes";
      }
      return choices.find(c => c.startsWith("Legacy Codex"));
    },
    confirm: async () => { throw new Error("OpenAI uses the Yes/No selector."); },
    notify: () => undefined,
  };
  await new UsageMenu(s.usage, s.now).inventory(ui, signal());
  assert.ok(titles.includes("OpenAI Resets"));
  const posts = s.requests.filter(r => r.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0]?.body, { credit_id: "credit2", redeem_request_id: "request_1" });
});

test("confirmed native reset menu spends exactly one credit and refreshes inventory", async t => {
  const s = await setup(t, "anthropic");
  const ui: UsageUI = {
    hasUI: true,
    select: async (title, choices, labels) => {
      if (title === "Anthropic Resets") {
        assert.deepEqual(labels, ["Reset · expires in 1d", "Reset · expires in 1d", "Back"]);
        return choices[1];
      }
      if (title.startsWith("Anthropic Reset Redeem")) {
        assert.equal(title, "Anthropic Reset Redeem\n\nAre you sure you want to redeem this banked reset that expires in 1d?");
        assert.deepEqual(choices, ["Yes", "No"]);
        assert.equal(s.requests.filter(r => r.method === "POST").length, 0);
        return "Yes";
      }
      return choices.find(c => c.startsWith("Claude"));
    },
    confirm: async () => { throw new Error("Anthropic uses the Yes/No selector."); },
    notify: () => undefined,
  };
  await new UsageMenu(s.usage, s.now).inventory(ui, signal());
  const posts = s.requests.filter(r => r.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.url, "https://api.anthropic.com/api/organizations/account1/reset_rate_limits");
  assert.deepEqual(posts[0]?.body, { program: "cedar_ember", grant_id: "grant1", request_id: "request_1" });
  const inventory = s.usage.getViews().find(v => v.provider === "anthropic")?.snapshot?.inventory;
  assert.ok(inventory?.kind === "known");
  assert.equal(inventory.credits[0]?.count, 1);
  assert.equal((await s.usage.getPending(await account(s.client), signal())).ok, true);
  let reopened = false;
  await new UsageMenu(s.usage, s.now).inventory({ ...ui, select: async (title, choices, labels) => {
    if (title === "Anthropic Resets") {
      reopened = true;
      assert.deepEqual(labels, ["Reset · expires in 1d", "Back"]);
      return "Back";
    }
    return choices.find(c => c.startsWith("Claude"));
  } }, signal());
  assert.ok(reopened);
  assert.equal(s.requests.filter(r => r.method === "POST").length, 1);
});

test("ambiguous mutation persists its key across restart; another credit is blocked", async t => {
  const s = await setup(t);
  await s.usage.refresh("codex", signal());
  const a = await account(s.client);
  s.consumeError("lost");
  const failed = await s.usage.redeem(a, "credit1", signal());
  assert.ok(!failed.ok && failed.error.kind === "uncertain");
  const pending = await s.usage.getPending(a, signal());
  assert.ok(pending.ok && pending.value?.requestId === "request_1");
  const restarted = s.service();
  const different = await restarted.redeem(a, "credit2", signal());
  assert.ok(!different.ok && different.error.kind === "uncertain");
  s.consumeError();
  const retried = await restarted.redeem(a, "credit1", signal());
  assert.deepEqual(retried, { ok: true, value: "reset" });
  const posts = s.requests.filter(r => r.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0]?.body, posts[1]?.body);
  const cleared = await restarted.getPending(a, signal());
  assert.ok(cleared.ok && cleared.value === undefined);
});

test("both providers' Yes/No retry confirmations keep the pending request ID", async t => {
  for (const provider of ["codex", "anthropic"] as const) {
    const s = await setup(t, provider);
    const label = provider === "codex" ? "OpenAI" : "Anthropic";
    await s.usage.refresh(provider, signal());
    const a = await account(s.client);
    s.consumeError("lost");
    await s.usage.redeem(a, provider === "codex" ? "credit1" : "grant1", signal());
    s.consumeError();
    let confirmed = false;
    await new UsageMenu(s.usage, s.now).inventory({
      hasUI: true, notify: () => undefined,
      confirm: async () => { throw new Error("Both providers use the Yes/No selector."); },
      select: async (title, choices, labels) => {
        if (title === `${label} Resets`) return choices.find(c => c.startsWith("Retry unconfirmed reset:"));
        if (title.startsWith(`${label} Reset Redeem`)) {
          assert.match(title, /expires in 1d/);
          assert.match(title, /This retries the previous claim with its saved request ID/);
          confirmed = true;
          return "Yes";
        }
        return choices[0];
      },
    }, signal());
    assert.ok(confirmed);
    const posts = s.requests.filter(r => r.method === "POST");
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0]?.body, posts[1]?.body);
  }
});

test("unknown successful HTTP body retains idempotency state", async t => {
  const s = await setup(t);
  const a = await account(s.client);
  s.consumeError("unknown");
  const result = await s.usage.redeem(a, "credit1", signal());
  assert.ok(!result.ok && result.error.kind === "uncertain");
  const pending = await s.usage.getPending(a, signal());
  assert.ok(pending.ok && pending.value);
});

test("reset endpoint 429 clears a rejected claim and blocks new claims until Retry-After", async t => {
  const s = await setup(t);
  const a = await account(s.client);
  s.consumeError("429");
  const first = await s.usage.redeem(a, "credit1", signal());
  assert.ok(!first.ok && first.error.kind === "rateLimited");
  const pending = await s.usage.getPending(a, signal());
  assert.ok(pending.ok && pending.value === undefined);
  const posts = s.requests.filter(r => r.method === "POST").length;
  await s.usage.redeem(a, "credit1", signal());
  assert.equal(s.requests.filter(r => r.method === "POST").length, posts);
  s.advance(120_001);
  s.consumeError();
  assert.equal((await s.usage.redeem(a, "credit1", signal())).ok, true);
});

test("a confirmed reset is not reclassified when its follow-up quota read fails", async t => {
  const s = await setup(t);
  const a = await account(s.client);
  // Prepare pending state so the retry can reach the mutation without a preflight read.
  await s.store.withAccount(a, signal(), async (_state, save) => save({ pending: { creditId: "credit1", requestId: "existing" } }));
  s.usageError(json({}, 503));
  const outcome = await s.usage.redeem(a, "credit1", signal());
  assert.deepEqual(outcome, { ok: true, value: "reset" });
  const pending = await s.usage.getPending(a, signal());
  assert.ok(pending.ok && !pending.value);
  assert.match(s.usage.getViews()[0]?.error?.message ?? "", /Reset outcome: reset/);
});

test("durable state corruption stops redemption before any POST", async t => {
  const s = await setup(t);
  const a = await account(s.client);
  await writeFile(join(s.directory, `${a.key}.json`), "invalid json");
  const result = await s.usage.redeem(a, "credit1", signal());
  assert.ok(!result.ok && result.error.kind === "storage");
  assert.equal(s.requests.filter(r => r.method === "POST").length, 0);
});

test("service tracks rejection/recovery per window and deduplicates within a turn", async t => {
  const s = await setup(t, "anthropic");
  await s.usage.refresh("anthropic", signal());
  const rejected = { windows: [], blocking: { windowId: "five_hour", rejected: true } };
  assert.match(s.usage.apply("anthropic", rejected) ?? "", /rejected/);
  assert.equal(s.usage.apply("anthropic", rejected), undefined);
  s.usage.apply("anthropic", { windows: [], blocking: { windowId: "seven_day", rejected: true } });
  s.usage.apply("anthropic", { windows: [], blocking: { windowId: "five_hour", rejected: false } });
  assert.deepEqual(s.usage.getBlocked("anthropic"), ["seven_day"]);
  s.usage.beginTurn();
  assert.ok(s.usage.apply("anthropic", rejected));
  assert.match(renderStatus(s.usage.getViews(), now, "anthropic") ?? "", /Anthropic • 5h ████████ 100%/);
});

test("HTTP abort, oversized bodies, redirects, and malformed mutation IDs fail closed", async () => {
  const aborted = new AbortController();
  aborted.abort();
  const requests: string[] = [];
  const http = new QuotaHttp(async input => { requests.push(String(input)); return json({ huge: "x".repeat(520 * 1024) }); }, () => now);
  const credential = { token: new Secret("synthetic") };
  assert.equal((await http.request({ kind: "codexUsage" }, credential, aborted.signal)).ok, false);
  assert.equal(requests.length, 0);
  assert.equal((await http.request({ kind: "codexUsage" }, credential, signal())).ok, false);
  const count = requests.length;
  assert.equal((await http.request({ kind: "claudeConsume", organization: "../escape", creditId: "valid", requestId: "valid" }, credential, signal())).ok, false);
  assert.equal(requests.length, count);
  const redirect = new QuotaHttp(async () => { throw new TypeError("redirect disallowed"); }, () => now);
  assert.equal((await redirect.request({ kind: "claudeProfile" }, credential, signal())).ok, false);
  assert.equal(JSON.stringify(credential), '{"token":"[REDACTED]"}');
  assert.ok(!inspect(credential).includes("synthetic"));
});

test("overlapping confirmations for a multi-use Claude grant cannot spend two resets", async t => {
  const s = await setup(t, "anthropic");
  const a = await account(s.client);
  const second = s.service();
  const results = await Promise.all([s.usage.redeem(a, "grant1", signal(), { count: 2 }), second.redeem(a, "grant1", signal(), { count: 2 })]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(s.requests.filter(r => r.method === "POST").length, 1);
});

test("a refreshed account view cannot regress behind newer passive windows", async t => {
  const s = await setup(t);
  await s.usage.refresh("codex", signal());
  s.advance(1000);
  s.usage.apply("codex", { windows: [{ id: "primary", label: "unused", usedPercent: 77 }] });
  await s.usage.refresh("codex", signal());
  const window = s.usage.getViews()[0]?.snapshot?.windows[0];
  assert.equal(window?.usedPercent, 77);
  assert.equal(window?.label, "7d");
});

test("cancelled quota reads do not persist backoff for a replacement session", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pi-usage-cancel-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  const account: Account = { provider: "codex", key: `codex-${"a".repeat(64)}`, label: "Synthetic account" };
  let reads = 0;
  const client = {
    discover: async () => ok(account),
    read: async () => {
      reads++;
      if (reads === 1) { controller.abort(); return fail(new UsageFailure("cancelled", "Synthetic shutdown")); }
      return ok({ account, checkedAt: now, windows: [{ id: "primary", label: "7d", usedPercent: 25 }], inventory: { kind: "known" as const, credits: [] } });
    },
    consume: async () => { throw new Error("This test must not redeem resets."); },
  };
  const usage = new SubscriptionUsage({ codex: client, anthropic: client }, new FileUsageStore(directory), () => now, () => "unused");
  await usage.refresh("codex", controller.signal);
  const next = await usage.refresh("codex", signal());
  assert.equal(reads, 2);
  assert.equal(next.snapshot?.windows[0]?.usedPercent, 25);
  assert.equal(next.error, undefined);
});

test("eligibility is rechecked after native confirmation", async t => {
  const s = await setup(t);
  let confirmed = false;
  const ui: UsageUI = {
    hasUI: true,
    select: async (title, choices, labels) => {
      if (title.startsWith("OpenAI Reset Redeem")) { confirmed = true; s.advance(2 * 24 * 60 * 60_000); return "Yes"; }
      return choices.find(c => c.startsWith("reset:")) ?? choices.find(c => c.startsWith("Legacy Codex"));
    },
    confirm: async () => { throw new Error("OpenAI uses the Yes/No selector."); },
    notify: () => undefined,
  };
  await new UsageMenu(s.usage, s.now).inventory(ui, signal());
  assert.ok(confirmed);
  assert.equal(s.requests.filter(r => r.method === "POST").length, 0);
});

test("account changes during confirmation stop redemption before sending", async t => {
  const s = await setup(t);
  let confirmed = false;
  const ui: UsageUI = {
    hasUI: true,
    select: async (title, choices, labels) => {
      if (title.startsWith("OpenAI Reset Redeem")) { confirmed = true; s.login("other", "other_account"); return "Yes"; }
      return choices.find(c => c.startsWith("reset:")) ?? choices.find(c => c.startsWith("Legacy Codex"));
    },
    confirm: async () => { throw new Error("OpenAI uses the Yes/No selector."); },
    notify: () => undefined,
  };
  await new UsageMenu(s.usage, s.now).inventory(ui, signal());
  assert.ok(confirmed);
  assert.equal(s.requests.filter(r => r.method === "POST").length, 0);
});

test("file locks serialize two OS processes, not only JavaScript callers", async t => {
  const s = await setup(t);
  const a = await account(s.client);
  const script = `import {FileUsageStore} from ${JSON.stringify(new URL("../store.ts", import.meta.url).href)};\nconst store=new FileUsageStore(process.argv[1]);\nconst account=JSON.parse(process.argv[2]);\nconst result=await store.withAccount(account,new AbortController().signal,async(state,save)=>{await new Promise(r=>setTimeout(r,100));return save({...state,nextPollAt:(state.nextPollAt??0)+1})});if(!result.ok)throw result.error;`;
  const run = () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, s.directory, JSON.stringify(a)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let error = "";
    child.stderr.on("data", chunk => { error += String(chunk); });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(error)));
  });
  await Promise.all([run(), run()]);
  const result = await s.store.withAccount(a, signal(), async state => ok(state.nextPollAt));
  assert.deepEqual(result, { ok: true, value: 2 });
});
