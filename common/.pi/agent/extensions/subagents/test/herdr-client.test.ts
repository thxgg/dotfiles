import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAgentStartArgs, buildTabCreateArgs, HerdrClient, parseAgentStarted, parseTabCreated,
  type CommandExecutor, type CommandResult,
} from "../herdr-client.ts";

const tabResponse = JSON.stringify({ id: "cli:tab:create", result: {
  type: "tab_created", tab: { tab_id: "w1:t2", workspace_id: "w1" },
  root_pane: { pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", terminal_id: "term_root" },
} });
const startResponse = JSON.stringify({ id: "cli:agent:start", result: {
  type: "agent_started", argv: ["pi"], agent: {
    terminal_id: "term_child", name: "pi-search-deadbeef", agent_status: "unknown",
    workspace_id: "w1", tab_id: "w1:t2", pane_id: "w1:p3", focused: false, revision: 0,
  },
} });
const infoResponse = JSON.stringify({ id: "cli:agent:get", result: {
  type: "agent_info", agent: {
    terminal_id: "term_child", name: "pi-search-deadbeef", agent_status: "working",
    workspace_id: "w1", tab_id: "w1:t2", pane_id: "w1:p3", focused: false, revision: 1,
  },
} });

class FakeExecutor implements CommandExecutor {
  calls: string[][] = [];
  private responses: CommandResult[];
  constructor(responses: CommandResult[]) { this.responses = responses; }
  async run(_command: string, args: string[]): Promise<CommandResult> {
    this.calls.push(args);
    return this.responses.shift() ?? { code: 0, stdout: JSON.stringify({ id: "x", result: { type: "ok" } }), stderr: "" };
  }
}

test("builds deterministic Herdr CLI argv without shell interpolation", () => {
  assert.deepEqual(buildTabCreateArgs("w1", "/tmp/a b", "search:deadbeef", { Z: "2", A: "/tmp/spec path" }), [
    "tab", "create", "--workspace", "w1", "--cwd", "/tmp/a b", "--label", "search:deadbeef", "--no-focus",
    "--env", "A=/tmp/spec path", "--env", "Z=2",
  ]);
  assert.deepEqual(buildAgentStartArgs({ name: "pi-search-deadbeef", paneId: "w1:p2", argv: ["node", "cli.js", "Task: don't shell-expand $HOME"] }), [
    "agent", "start", "pi-search-deadbeef", "--kind", "pi", "--pane", "w1:p2", "--", "node", "cli.js", "Task: don't shell-expand $HOME",
  ]);
});

test("parses Herdr tab and agent response envelopes", () => {
  assert.equal(parseTabCreated(tabResponse).root_pane.pane_id, "w1:p2");
  assert.equal(parseAgentStarted(startResponse).agent.terminal_id, "term_child");
});

test("launches Pi in the dedicated tab root pane", async () => {
  const fake = new FakeExecutor([
    { code: 0, stdout: tabResponse, stderr: "" },
    { code: 0, stdout: startResponse, stderr: "" },
  ]);
  const launched = await new HerdrClient(fake, "herdr").launch({ workspaceId: "w1", cwd: "/tmp", label: "search:x", agentName: "pi-search-deadbeef", env: { PI_SUBAGENT_JOB_SPEC: "/tmp/spec" }, argv: ["pi"], });
  assert.equal(launched.metadata.paneId, "w1:p3");
  assert.deepEqual(launched.warnings, []);
  assert.deepEqual(fake.calls[1], ["agent", "start", "pi-search-deadbeef", "--kind", "pi", "--pane", "w1:p2", "--", "pi"]);
});

test("retries agent start while the new tab shell is not ready", async () => {
  const fake = new FakeExecutor([
    { code: 0, stdout: tabResponse, stderr: "" },
    { code: 1, stdout: JSON.stringify({ error: { code: "agent_pane_busy", message: "agent target pane is not an available shell" } }), stderr: "" },
    { code: 0, stdout: startResponse, stderr: "" },
  ]);
  const launched = await new HerdrClient(fake, "herdr").launch({ workspaceId: "w1", cwd: "/tmp", label: "x", agentName: "pi-x", env: {}, argv: ["pi"] });
  assert.equal(launched.metadata.paneId, "w1:p3");
  assert.deepEqual(fake.calls[1], fake.calls[2]);
});

test("rolls back the temporary tab when agent start fails", async () => {
  const fake = new FakeExecutor([
    { code: 0, stdout: tabResponse, stderr: "" },
    { code: 1, stdout: "", stderr: "spawn failed" },
    { code: 0, stdout: JSON.stringify({ id: "x", result: { type: "ok" } }), stderr: "" },
  ]);
  await assert.rejects(() => new HerdrClient(fake, "herdr").launch({ workspaceId: "w1", cwd: "/tmp", label: "x", agentName: "pi-x", env: {}, argv: ["pi"] }), /spawn failed/);
  assert.deepEqual(fake.calls[2], ["tab", "close", "w1:t2"]);
});

test("sending a follow-up resolves the child and submits literal text with Enter", async () => {
  const fake = new FakeExecutor([
    { code: 0, stdout: infoResponse, stderr: "" },
    { code: 0, stdout: JSON.stringify({ id: "x", result: { type: "ok" } }), stderr: "" },
    { code: 0, stdout: JSON.stringify({ id: "x", result: { type: "ok" } }), stderr: "" },
  ]);
  await new HerdrClient(fake, "herdr").send("pi-search-deadbeef", "continue this");
  assert.deepEqual(fake.calls, [
    ["agent", "get", "pi-search-deadbeef"],
    ["agent", "send", "pi-search-deadbeef", "continue this"],
    ["pane", "send-keys", "w1:p3", "enter"],
  ]);
});

test("cancellation resolves by unique name before sending escape to its live pane", async () => {
  const fake = new FakeExecutor([
    { code: 0, stdout: infoResponse, stderr: "" },
    { code: 0, stdout: JSON.stringify({ id: "x", result: { type: "ok" } }), stderr: "" },
  ]);
  const current = await new HerdrClient(fake, "herdr").requestCancel("pi-search-deadbeef");
  assert.equal(current?.pane_id, "w1:p3");
  assert.deepEqual(fake.calls, [["agent", "get", "pi-search-deadbeef"], ["pane", "send-keys", "w1:p3", "esc"]]);
});
