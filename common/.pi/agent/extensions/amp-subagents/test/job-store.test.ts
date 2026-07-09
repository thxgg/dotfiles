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
  const spec = { version: 1 as const, jobId: id, stateDir: paths.dir, promptPath: paths.prompt, createdAt: snapshot.startedAt, agent };
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
