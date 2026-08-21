import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { discoverAgents } from "../agents.ts";
import { JobStore } from "../job-store.ts";
import type { AgentJobSnapshot } from "../job-types.ts";

function fixture(store: JobStore, id = "agent-deadbeef") {
  const agent = discoverAgents(process.cwd(), "builtin").agents.find((item) => item.name === "search")!;
  const paths = store.paths(id);
  const snapshot: AgentJobSnapshot = {
    id, agent: agent.name, source: agent.source, task: "inspect", cwd: process.cwd(),
    status: "queued", background: true, backend: "herdr", startedAt: new Date().toISOString(),
  };
  const spec = { version: 2 as const, jobId: id, stateDir: paths.dir, promptPath: paths.prompt, createdAt: snapshot.startedAt, agent };
  return { agent, paths, snapshot, spec };
}

test("job store writes private atomic records and recovers them from disk", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-job-store-"));
  try {
    const store = new JobStore(root);
    const item = fixture(store);
    store.initialize(item.spec, item.snapshot, "secret prompt");
    store.update(item.snapshot.id, (current) => ({ ...current, status: "running", sessionFile: "/tmp/session.jsonl" }));

    const recovered = new JobStore(root).list();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, "running");
    assert.equal(recovered[0].sessionFile, "/tmp/session.jsonl");
    assert.equal(fs.statSync(item.paths.state).mode & 0o777, 0o600);
    assert.equal(fs.statSync(item.paths.prompt).mode & 0o777, 0o600);
    assert.equal(fs.statSync(item.paths.dir).mode & 0o777, 0o700);
    assert.equal(fs.readdirSync(item.paths.dir).some((name) => name.endsWith(".tmp")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("job store migrates v1 state and specs during rolling extension upgrades", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-job-store-"));
  try {
    const store = new JobStore(root);
    const item = fixture(store);
    store.initialize(item.spec, item.snapshot, "prompt");
    const state = JSON.parse(fs.readFileSync(item.paths.state, "utf8"));
    const spec = JSON.parse(fs.readFileSync(item.paths.spec, "utf8"));
    state.version = 1;
    delete state.attempt;
    spec.version = 1;
    fs.writeFileSync(item.paths.state, JSON.stringify(state));
    fs.writeFileSync(item.paths.spec, JSON.stringify(spec));
    assert.equal(store.read(item.snapshot.id)?.attempt, 1);
    assert.equal(store.readSpecFile(item.paths.spec).version, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a stale-looking lock owned by a live process is never stolen", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-job-store-"));
  try {
    const store = new JobStore(root);
    const item = fixture(store);
    store.initialize(item.spec, item.snapshot, "prompt");
    fs.writeFileSync(item.paths.lock, `${process.pid}:live-token 0\n`);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(item.paths.lock, old, old);
    assert.throws(() => store.update(item.snapshot.id, (current) => current), /Timed out acquiring/);
    assert.equal(fs.readFileSync(item.paths.lock, "utf8").includes("live-token"), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("job store ignores corrupt and path-traversal records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-job-store-"));
  try {
    const store = new JobStore(root);
    const item = fixture(store);
    store.initialize(item.spec, item.snapshot, "prompt");
    fs.writeFileSync(item.paths.state, "{broken", "utf8");
    assert.deepEqual(store.list(), []);
    assert.throws(() => store.paths("../../escape"), /Invalid/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("notification claims are leased and delivered idempotently", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-job-store-"));
  try {
    const store = new JobStore(root);
    const item = fixture(store);
    store.initialize(item.spec, item.snapshot, "prompt");
    store.addNotification(item.snapshot.id, { id: "notification-1", kind: "completion", createdAt: new Date().toISOString() });
    store.claimNotification(item.snapshot.id, "notification-1", "owner-a", 60_000);
    store.claimNotification(item.snapshot.id, "notification-1", "owner-b", 60_000);
    assert.equal(store.read(item.snapshot.id)?.notifications?.[0].leaseOwner, "owner-a");
    store.completeNotification(item.snapshot.id, "notification-1", "owner-b");
    assert.equal(store.read(item.snapshot.id)?.notifications?.[0].state, "delivering");
    store.completeNotification(item.snapshot.id, "notification-1", "owner-a");
    assert.equal(store.read(item.snapshot.id)?.notifications?.[0].state, "delivered");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("pruning preserves terminal jobs with undelivered notifications", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-job-store-"));
  try {
    const store = new JobStore(root);
    for (const id of ["agent-00000001", "agent-00000002"]) {
      const item = fixture(store, id);
      store.initialize(item.spec, { ...item.snapshot, status: "completed", endedAt: new Date().toISOString(), notifications: id.endsWith("1") ? [{ id: "notification-1", kind: "completion", state: "pending", createdAt: new Date().toISOString() }] : undefined }, "prompt");
    }
    store.prune(0);
    assert.ok(store.read("agent-00000001"));
    assert.equal(store.read("agent-00000002"), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("explicit result retrieval can consume pending completion delivery", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-consume-"));
  const store = new JobStore(root);
  try {
    const item = fixture(store, "agent-aabbccdd");
    store.initialize(item.spec, { ...item.snapshot, status: "completed", notifications: [{ id: "done", kind: "completion", state: "pending", createdAt: new Date().toISOString() }] }, "prompt");
    const consumed = store.consumeCompletionNotifications(item.snapshot.id);
    assert.equal(consumed?.notifications?.[0]?.state, "consumed");
    assert.ok(consumed?.notifications?.[0]?.obsoleteAt);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("pruning never removes running jobs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-job-store-"));
  try {
    const store = new JobStore(root);
    for (const [id, status] of [["agent-00000001", "running"], ["agent-00000002", "completed"], ["agent-00000003", "completed"]] as const) {
      const item = fixture(store, id);
      store.initialize(item.spec, { ...item.snapshot, status, endedAt: status === "completed" ? new Date().toISOString() : undefined }, "prompt");
    }
    store.prune(1);
    assert.equal(store.read("agent-00000001")?.status, "running");
    assert.equal(store.list().filter((job) => job.status === "completed").length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
