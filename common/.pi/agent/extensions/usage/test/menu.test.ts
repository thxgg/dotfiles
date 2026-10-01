import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok, UsageFailure, type Provider, type Snapshot, type Inventory } from "../domain.ts";
import { renderLoadingStatus, renderStatus, renderView, viewsForModel, UsageMenu, type UsageUI } from "../menu.ts";
import { accountKey } from "../providers.ts";
import { SubscriptionUsage, type UsageView } from "../service.ts";
import { FileUsageStore } from "../store.ts";

const now = Date.parse("2026-10-01T00:00:00Z");
function snapshot(provider: Provider, usedPercent = 25): Snapshot {
  return {
    account: { provider, key: accountKey(provider, "menu-test"), label: provider === "codex" ? "Legacy Codex test" : "Claude test" },
    checkedAt: now,
    windows: [{ id: "primary", label: "7d", usedPercent, resetsAt: now + 60_000 }],
    inventory: { kind: "known", credits: [{ id: "reset1", count: 2, status: "available" }] },
  };
}
function view(provider: Provider, usedPercent = 25): UsageView {
  const value = snapshot(provider, usedPercent);
  return { provider, account: value.account, snapshot: value };
}
const views = [view("codex"), view("anthropic", 100)];

test("quota UI shows remaining percentages and bars, with full/empty boundary values", () => {
  for (const [used, compact, detail] of [
    [0, "████████ 100%", "████████████████ 100.0%"],
    [25, "██████░░ 75%", "████████████░░░░ 75.0%"],
    [100, "░░░░░░░░ 0%", "░░░░░░░░░░░░░░░░ 0.0%"],
  ] as const) {
    const usage = view("codex", used);
    assert.ok(renderStatus([usage], now, "openai")?.includes(compact));
    const report = renderView(usage, now);
    assert.ok(report.includes(detail));
    assert.doesNotMatch(report, /% used|% left|\[[█░]|[█░]\]/);
    assert.match(report, /resets/);
  }
  assert.match(renderView(view("anthropic", 0.5), now), /99\.5%/);
});

test("footer matches extmgr bullet separators and begins with a pipe", () => {
  assert.equal(renderStatus(views, now, "openai"), "| OpenAI • ██████░░ 75% • ↻ 2");
  assert.equal(renderStatus(views, now, "openai-codex"), renderStatus(views, now, "openai"));
  assert.equal(renderStatus(views, now, "anthropic"), "| Anthropic • 7d ░░░░░░░░ 0% • ↻ 2");
});

test("OpenAI details show identity, marketing plan, relative times, compact credits, and usable resets", () => {
  const base = snapshot("codex", 14);
  const value: Snapshot = {
    ...base, account: { ...base.account, accountId: "synthetic-account" }, plan: "promax", purchasedCredits: 62500,
    checkedAt: now - 125_000,
    windows: [{ id: "primary", label: "7d", usedPercent: 14, resetsAt: now + (6 * 24 + 22) * 3600_000 }],
  };
  const usage: UsageView = { provider: "codex", account: value.account, snapshot: value };
  assert.equal(renderView(usage, now), [
    "OpenAI", "", "ID: synthetic-account", "Plan: Pro 500", "Last checked: 2m 5s ago",
    "Usage: ██████████████░░ 86.0% · resets in 6d 22h", "Credits: 62.5k", "Resets: 2",
  ].join("\n"));
  assert.doesNotMatch(renderView(usage, now), /7d|Legacy Codex|Purchased credits|Reset credits listed/);
  assert.doesNotMatch(renderStatus([usage], now, "openai") ?? "", /7d/);
  for (const [plan, label] of [["prolite", "Pro 100"], ["pro", "Pro 200"], ["promax", "Pro 500"], ["plus", "Plus"], ["team", "Business"], ["future_plan", "future_plan"]] as const) {
    assert.ok(renderView({ ...usage, snapshot: { ...value, plan } }, now).includes(`Plan: ${label}`));
  }
});

test("Anthropic details align usage rows and omit unknown reset times", () => {
  const base = snapshot("anthropic");
  const value: Snapshot = {
    ...base, account: { ...base.account, organizationName: "Synthetic organization" },
    windows: [
      { id: "five_hour", label: "5h", usedPercent: 0 },
      { id: "seven_day", label: "7d", usedPercent: 25, resetsAt: now + 7200_000 },
    ], inventory: { kind: "known", credits: [] },
  };
  const usage: UsageView = { provider: "anthropic", account: value.account, snapshot: value };
  assert.equal(renderView(usage, now), [
    "Anthropic", "", "Organization: Synthetic organization", "Last checked: just now",
    "Usage: 5h · ████████████████ 100.0%",
    "       7d · ████████████░░░░ 75.0% · resets in 2h", "Resets: none",
  ].join("\n"));
  assert.doesNotMatch(renderView(usage, now), /Plan:|Credits:|resets not reported/);
});

test("relative times and credits handle boundary values without false reset or balance data", () => {
  const base = snapshot("codex");
  const render = (overrides: Partial<Snapshot>) => renderView({ provider: "codex", snapshot: { ...base, ...overrides } }, now);
  assert.match(render({ checkedAt: now + 5000 }), /Last checked: just now/);
  assert.match(render({ checkedAt: now - 86400_000 }), /Last checked: 1d ago/);
  assert.match(render({ windows: [{ id: "primary", label: "7d", usedPercent: 100, resetsAt: now - 1000 }] }), /resets in 0s/);
  assert.doesNotMatch(render({ windows: [{ id: "primary", label: "7d", usedPercent: 100 }] }), /resets in/);
  for (const [credits, display] of [[0, "0"], [999, "999"], [1000, "1k"], [62500, "62.5k"], [1000000, "1M"]] as const) {
    assert.ok(render({ purchasedCredits: credits }).includes(`Credits: ${display}\n`));
  }
  assert.match(render({}), /Credits: not reported/);
  assert.match(render({ inventory: { kind: "unavailable", message: "Synthetic failure" } }), /Resets: unavailable\nSynthetic failure/);
});

test("initial loading uses a moving eight-cell block and a spinner percentage, never a number", () => {
  const frames = Array.from({ length: 80 }, (_, frame) => renderLoadingStatus("openai", frame));
  assert.equal(frames[0], "| OpenAI • █░░░░░░░ ⠋%");
  assert.equal(frames[2], "| OpenAI • ░█░░░░░░ ⠹%");
  assert.equal(frames[14], "| OpenAI • ░░░░░░░█ ⠼%");
  assert.equal(frames[16], "| OpenAI • █░░░░░░░ ⠦%");
  for (const text of frames) assert.match(text ?? "", /^\| OpenAI • ░*█░* [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]%$/);
  assert.equal(renderLoadingStatus("openai-codex", 2), frames[2]);
  assert.equal(renderLoadingStatus("anthropic", 2), "| Anthropic • ░█░░░░░░ ⠹%");
  for (const provider of [undefined, "google"]) assert.equal(renderLoadingStatus(provider, 0), undefined);
  assert.equal(renderLoadingStatus("openai", 0, "reduced"), "| OpenAI • ░░░█░░░░ …%");
  assert.equal(renderLoadingStatus("openai", 50, "reduced"), renderLoadingStatus("openai", 0, "reduced"));
});

test("footer hides the reset module when no usable resets remain", () => {
  for (const credits of [[], [{ id: "empty", count: 0, status: "available" as const }], [{ id: "expired", count: 2, status: "available" as const, expiresAt: now - 1 }]]) {
    const value = snapshot("codex");
    const usage: UsageView = { provider: "codex", snapshot: { ...value, inventory: { kind: "known", credits } } };
    assert.equal(renderStatus([usage], now, "openai"), "| OpenAI • ██████░░ 75%");
  }
});

test("all quota display filtering uses the current model provider, never another account", () => {
  for (const provider of ["openai", "openai-codex"]) assert.deepEqual(viewsForModel(views, provider).map(v => v.provider), ["codex"]);
  assert.deepEqual(viewsForModel(views, "anthropic").map(v => v.provider), ["anthropic"]);
  for (const provider of [undefined, "google", "openrouter"]) {
    assert.deepEqual(viewsForModel(views, provider), []);
    assert.equal(renderStatus(views, now, provider), undefined);
  }
  assert.equal(renderStatus([{ provider: "codex" }], now, "openai"), undefined);
});

test("stale quota reports retain remaining bars and reset counts", () => {
  const usage = { ...view("codex"), error: new UsageFailure("network", "Synthetic unavailable") };
  assert.match(renderView(usage, now), /STALE/);
  assert.match(renderView(usage, now), /75\.0%/);
  assert.match(renderStatus([usage], now, "openai") ?? "", /75% • ↻ 2 \[stale\]/);
});

async function menu(t: { after: (callback: () => Promise<void>) => void }, inventory?: Inventory) {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-menu-test-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const client = (provider: Provider) => ({
    discover: async () => ok(snapshot(provider).account),
    read: async () => ok({ ...snapshot(provider), ...(inventory ? { inventory } : {}) }),
    consume: async () => { throw new Error("UI display tests must never redeem a reset."); },
  });
  const service = new SubscriptionUsage({ codex: client("codex"), anthropic: client("anthropic") }, new FileUsageStore(dir), () => now, () => "unused");
  return new UsageMenu(service, () => now);
}

test("native dashboard has both footer-style provider rows and Close, with provider details", async t => {
  const usage = await menu(t);
  for (const [provider, selectedIndex] of [["openai", 1], ["anthropic", 0], ["google", 1]] as const) {
    const titles: string[] = [], offered: string[][] = [];
    const ui: UsageUI = {
      hasUI: true,
      select: async (title, choices, labels) => {
        titles.push(title); offered.push(labels ?? choices);
        return titles.length === 1 ? choices[selectedIndex] : titles.length === 2 ? "Back" : "Close";
      },
      confirm: async () => { throw new Error("Dashboard must not request redemption confirmation."); },
      notify: () => undefined,
    };
    await usage.open(ui, new AbortController().signal, provider);
    assert.equal(titles[0], "Subscription usage");
    assert.deepEqual(offered[0], [
      "OpenAI • ██████░░ 75% • ↻ 2",
      "Anthropic • 7d ██████░░ 75% • ↻ 2",
      "Close",
    ]);
    assert.equal(titles[1], renderView(view(selectedIndex === 0 ? "codex" : "anthropic"), now));
    assert.deepEqual(offered[1], ["Resets inventory", "Back"]);
    assert.deepEqual(offered[2], offered[0]);
  }
});

test("non-interactive reports remain provider-filtered; unsupported providers do not show quotas", async t => {
  const usage = await menu(t);
  const messages: string[] = [];
  const ui: UsageUI = { hasUI: false, notify: text => { messages.push(text); }, select: async () => undefined, confirm: async () => false };
  await usage.open(ui, new AbortController().signal, "openai");
  assert.match(messages[0] ?? "", /^OpenAI\n/);
  assert.doesNotMatch(messages[0] ?? "", /^Anthropic\n/);
  assert.match(messages[0] ?? "", /75\.0%/);
  await usage.open(ui, new AbortController().signal, "google");
  assert.equal(messages[1], "No subscription quota monitor is available for the current model provider.");
});

test("details offer Resets inventory only when the account has usable resets", async t => {
  const inventories: Inventory[] = [
    { kind: "known", credits: [] },
    { kind: "known", credits: [{ id: "zero", count: 0, status: "available" }] },
    { kind: "known", credits: [{ id: "expired", count: 2, status: "available", expiresAt: now - 1 }] },
    { kind: "known", credits: [{ id: "paused", count: 3, status: "paused" }] },
    { kind: "unavailable", message: "Not reported" },
    { kind: "known", credits: [{ id: "usable", count: 3, status: "available" }] },
  ];
  for (const inventory of inventories) {
    const usage = await menu(t, inventory);
    for (const selectedIndex of [0, 1]) {
      const offered: string[][] = [], titles: string[] = [];
      const ui: UsageUI = { hasUI: true, notify: () => undefined, confirm: async () => false,
        select: async (title, choices, labels) => {
          titles.push(title); offered.push(labels ?? choices);
          return offered.length === 1 ? choices[selectedIndex] : offered.length === 2 ? "Back" : "Close";
        } };
      await usage.open(ui, new AbortController().signal, "openai");
      const available = inventory.kind === "known" && inventory.credits[0]?.id === "usable";
      assert.deepEqual(offered[1], available ? ["Resets inventory", "Back"] : ["Back"]);
      assert.ok(titles[1]?.includes(`Resets: ${available ? "3" : inventory.kind === "known" ? "none" : "unavailable"}`));
    }
  }
});

test("OpenAI reset list uses a provider heading and relative expiry without credit IDs", async t => {
  const usage = await menu(t, { kind: "known", credits: [
    { id: "first-credit", count: 1, status: "available", expiresAt: now + (20 * 24 + 5) * 3600_000 },
    { id: "second-credit", count: 1, status: "available", expiresAt: now + (27 * 24 + 3) * 3600_000 },
  ] });
  const titles: string[] = [], offered: string[][] = [];
  const ui: UsageUI = {
    hasUI: true, notify: () => undefined,
    select: async (title, choices, labels) => {
      titles.push(title); offered.push(labels ?? choices);
      if (titles.length === 1) return choices[0];
      if (titles.length === 2) return "Resets inventory";
      if (titles.length === 3) return choices[1];
      if (titles.length === 4) return "No";
      return "Close";
    },
    confirm: async () => { throw new Error("OpenAI uses the Yes/No selector."); },
  };
  await usage.open(ui, new AbortController().signal, "openai");
  assert.equal(titles[2], "OpenAI Resets");
  assert.deepEqual(offered[2], ["Reset · expires in 20d 5h", "Reset · expires in 27d 3h", "Back"]);
  assert.equal(titles[3], "OpenAI Reset Redeem\n\nAre you sure you want to redeem this banked reset that expires in 27d 3h?");
  assert.deepEqual(offered[3], ["Yes (another reset expires sooner)", "No"]);
});

test("OpenAI confirmation warns only about a sooner usable reset and requires the offered Yes", async t => {
  const selected = { id: "selected", count: 1, status: "available" as const, expiresAt: now + 7200_000 };
  for (const other of [
    { id: "earlier", count: 1, status: "available" as const, expiresAt: now + 3600_000 },
    { id: "tied", count: 1, status: "available" as const, expiresAt: selected.expiresAt },
    { id: "later", count: 1, status: "available" as const, expiresAt: now + 10800_000 },
    { id: "expired", count: 1, status: "available" as const, expiresAt: now - 1 },
    { id: "paused", count: 1, status: "paused" as const, expiresAt: now + 3600_000 },
    { id: "empty", count: 0, status: "available" as const, expiresAt: now + 3600_000 },
  ]) {
    const usage = await menu(t, { kind: "known", credits: [other, selected] });
    for (const response of ["No", undefined, "abort"] as const) {
      const controller = new AbortController();
      let confirmations = 0;
      await usage.inventory({
        hasUI: true, notify: () => undefined,
        confirm: async () => { throw new Error("OpenAI uses the Yes/No selector."); },
        select: async (title, choices, labels) => {
          if (title === "OpenAI Resets") return choices[1];
          if (title.startsWith("OpenAI Reset Redeem")) {
            confirmations++;
            assert.equal(title, "OpenAI Reset Redeem\n\nAre you sure you want to redeem this banked reset that expires in 2h?");
            assert.deepEqual(choices, [other.id === "earlier" ? "Yes (another reset expires sooner)" : "Yes", "No"]);
            if (response === "abort") { controller.abort(); return choices[0]; }
            return response;
          }
          return choices[0];
        },
      }, controller.signal);
      assert.equal(confirmations, 1);
    }
  }
});

test("OpenAI reset list keeps expired and unknown inventory honest and non-redeemable", async t => {
  const usage = await menu(t, { kind: "known", credits: [
    { id: "expired-credit", count: 1, status: "expired", expiresAt: now - 3600_000 },
    { id: "unknown-credit", count: 1, status: "unknown" },
  ] });
  const messages: string[] = [];
  await usage.inventory({
    hasUI: true, notify: message => messages.push(message),
    select: async (title, choices, labels) => {
      if (title === "OpenAI Resets") assert.deepEqual(labels, ["Reset · expired 1h ago", "Reset · expiry unknown · unknown", "Back"]);
      return choices[0];
    },
    confirm: async () => { throw new Error("Expired credits must not reach confirmation."); },
  }, new AbortController().signal);
  assert.deepEqual(messages, ["This credit is not currently usable."]);
});

test("Anthropic expands grants into individual reset rows and hides unknown expiry in both screens", async t => {
  const usage = await menu(t, { kind: "known", credits: [
    { id: "known", count: 2, status: "available", expiresAt: now + 7200_000 },
    { id: "unknown-expiry", count: 2, status: "available" },
    { id: "sooner", count: 1, status: "available", expiresAt: now + 3600_000 },
    { id: "empty", count: 0, status: "redeemed" },
  ] });
  for (const selectedIndex of [0, 1, 2, 3, 4]) {
    for (const response of ["No", undefined, "abort"] as const) {
      const controller = new AbortController();
      let confirmed = false;
      await usage.inventory({
        hasUI: true, notify: () => undefined,
        confirm: async () => { throw new Error("Anthropic uses the Yes/No selector."); },
        select: async (title, choices, labels) => {
          if (title === "Anthropic Resets") {
            assert.deepEqual(labels, ["Reset · expires in 2h", "Reset · expires in 2h", "Reset", "Reset", "Reset · expires in 1h", "Back"]);
            return choices[selectedIndex];
          }
          if (title.startsWith("Anthropic Reset Redeem")) {
            confirmed = true;
            const expiry = selectedIndex < 2 ? " that expires in 2h" : selectedIndex === 4 ? " that expires in 1h" : "";
            assert.equal(title, `Anthropic Reset Redeem\n\nAre you sure you want to redeem this banked reset${expiry}?`);
            assert.deepEqual(choices, [selectedIndex < 2 ? "Yes (another reset expires sooner)" : "Yes", "No"]);
            if (response === "abort") { controller.abort(); return choices[0]; }
            return response;
          }
          return choices.find(c => c.startsWith("Claude"));
        },
      }, controller.signal);
      assert.ok(confirmed);
    }
  }
});

test("Anthropic unavailable resets stay non-redeemable when grants expand", async t => {
  const usage = await menu(t, { kind: "known", credits: [{ id: "paused", count: 2, status: "paused" }] });
  const messages: string[] = [];
  await usage.inventory({
    hasUI: true, notify: message => messages.push(message),
    confirm: async () => { throw new Error("Paused resets must not reach confirmation."); },
    select: async (title, choices, labels) => {
      if (title === "Anthropic Resets") {
        assert.deepEqual(labels, ["Reset · paused", "Reset · paused", "Back"]);
        return choices[1];
      }
      assert.ok(!title.startsWith("Anthropic Reset Redeem"));
      return choices.find(c => c.startsWith("Claude"));
    },
  }, new AbortController().signal);
  assert.deepEqual(messages, ["This credit is not currently usable."]);
});

test("large Anthropic grant counts expand in bounded pages without losing row identity", async t => {
  const usage = await menu(t, { kind: "known", credits: [
    { id: "first", count: 101, status: "available" },
    { id: "second", count: Number.MAX_SAFE_INTEGER, status: "available", expiresAt: now + 3600_000 },
  ] });
  let pages = 0, confirmed = false;
  await usage.inventory({
    hasUI: true, notify: () => undefined,
    confirm: async () => { throw new Error("Anthropic uses the Yes/No selector."); },
    select: async (title, choices, labels) => {
      if (title === "Anthropic Resets") {
        pages++;
        assert.ok(choices.length <= 103);
        if (pages === 1 || pages === 3) {
          assert.equal(labels?.[0], "Reset");
          assert.equal(labels?.[99], "Reset");
          return "Next page";
        }
        if (pages === 2) return "Previous page";
        assert.equal(labels?.[0], "Reset");
        assert.equal(labels?.[1], "Reset · expires in 1h");
        return choices[1];
      }
      if (title.startsWith("Anthropic Reset Redeem")) {
        confirmed = true;
        assert.match(title, /reset that expires in 1h\?/);
        assert.deepEqual(choices, ["Yes", "No"]);
        return "No";
      }
      return choices.find(c => c.startsWith("Claude"));
    },
  }, new AbortController().signal);
  assert.equal(pages, 4);
  assert.ok(confirmed);
});

test("reset inventory retains the existing account picker for both providers", async t => {
  const usage = await menu(t);
  let choices: string[] = [];
  const ui: UsageUI = { hasUI: true, select: async (_title, offered) => { choices = offered; return "Back"; }, confirm: async () => false, notify: () => undefined };
  await usage.inventory(ui, new AbortController().signal);
  assert.ok(choices.includes("Legacy Codex test"));
  assert.ok(choices.includes("Claude test"));
});
