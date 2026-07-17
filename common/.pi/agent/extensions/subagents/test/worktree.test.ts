import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { discoverAgents } from "../agents.ts";
import { JobStore } from "../job-store.ts";
import type { AgentJobSnapshot } from "../job-types.ts";
import { applyAgentWorktree, createAgentWorktree, discardAgentWorktree, isWriteCapable } from "../worktree.ts";

function git(cwd: string, ...args: string[]): string {
  return String(execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" })).trim();
}

test("write-capable agents get isolated worktrees that require explicit apply", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-worktree-"));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-state-"));
  try {
    git(root, "init", "-q");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    fs.writeFileSync(path.join(root, "tracked.txt"), "before\n");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-qm", "initial");
    const agent = discoverAgents(root, "builtin").agents.find((item) => item.name === "agent")!;
    assert.equal(isWriteCapable(agent), true);
    const store = new JobStore(state);
    const job: AgentJobSnapshot = { id: "agent-deadbeef", agent: agent.name, source: agent.source, task: "edit", cwd: root, status: "queued", background: true, backend: "herdr", startedAt: new Date().toISOString() };
    const paths = store.paths(job.id);
    store.initialize({ version: 2, jobId: job.id, stateDir: paths.dir, promptPath: paths.prompt, createdAt: job.startedAt, agent }, job, "prompt");
    const worktree = createAgentWorktree(job, agent, store)!;
    fs.writeFileSync(path.join(worktree.path, "tracked.txt"), "after\n");
    fs.writeFileSync(path.join(worktree.path, "new.txt"), "new\n");
    assert.equal(fs.readFileSync(path.join(root, "tracked.txt"), "utf8"), "before\n");
    const applied = applyAgentWorktree({ ...job, status: "completed", endedAt: new Date().toISOString(), worktree });
    assert.equal(fs.readFileSync(path.join(root, "tracked.txt"), "utf8"), "after\n");
    assert.equal(fs.readFileSync(path.join(root, "new.txt"), "utf8"), "new\n");
    assert.ok(applied.worktree?.appliedAt);
    const discarded = discardAgentWorktree({ ...job, status: "completed", endedAt: new Date().toISOString(), worktree });
    assert.ok(discarded.worktree?.discardedAt);
    assert.equal(git(root, "branch", "--list", worktree.branch!), "");
  } finally {
    try { git(root, "worktree", "prune"); } catch { /* ignore */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test("write-capable agents reject dirty parent checkouts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-worktree-dirty-"));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-state-"));
  try {
    git(root, "init", "-q");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    fs.writeFileSync(path.join(root, "tracked.txt"), "before\n");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-qm", "initial");
    fs.writeFileSync(path.join(root, "tracked.txt"), "dirty\n");
    const agent = discoverAgents(root, "builtin").agents.find((item) => item.name === "agent")!;
    const store = new JobStore(state);
    const job: AgentJobSnapshot = { id: "agent-deadbeef", agent: agent.name, source: agent.source, task: "edit", cwd: root, status: "queued", background: true, backend: "herdr", startedAt: new Date().toISOString() };
    const paths = store.paths(job.id);
    store.initialize({ version: 2, jobId: job.id, stateDir: paths.dir, promptPath: paths.prompt, createdAt: job.startedAt, agent }, job, "prompt");
    assert.throws(() => createAgentWorktree(job, agent, store), /clean Git checkout/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test("read-only agents share the parent checkout", () => {
  const search = discoverAgents(process.cwd(), "builtin").agents.find((item) => item.name === "search")!;
  assert.equal(isWriteCapable(search), false);
});
