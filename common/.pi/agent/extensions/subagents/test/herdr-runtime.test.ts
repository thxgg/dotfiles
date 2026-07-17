import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { discoverAgents } from "../agents.ts";
import { closeCompletedHerdrTab } from "../child-bridge.ts";
import { buildChildPiArgs, getPiInvocation, makeHerdrNames, shouldUseHerdr } from "../herdr-runtime.ts";
import { createAgentTool, formatJobSummary } from "../runtime.ts";
import type { AgentJobSnapshot } from "../job-types.ts";

test("selects Herdr only with the managed environment and connection placement", () => {
  assert.equal(shouldUseHerdr({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/herdr.sock", HERDR_WORKSPACE_ID: "w1" }), true);
  assert.equal(shouldUseHerdr({ HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w1" }), false);
  assert.equal(shouldUseHerdr({ HERDR_SOCKET_PATH: "/tmp/herdr.sock", HERDR_WORKSPACE_ID: "w1" }), false);
});

test("does not mistake an arbitrary Node entry script for the Pi CLI", () => {
  assert.deepEqual(getPiInvocation(["--version"]), { command: "pi", args: ["--version"] });
});

test("legacy explicit close helper remains non-blocking", () => {
  const previous = { HERDR_ENV: process.env.HERDR_ENV, HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH, HERDR_BIN_PATH: process.env.HERDR_BIN_PATH };
  const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
  let unrefCalled = false;
  try {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_SOCKET_PATH = "/tmp/herdr.sock";
    process.env.HERDR_BIN_PATH = "/opt/herdr";
    closeCompletedHerdrTab("w1:t2", ((command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      return { on: () => undefined, unref: () => { unrefCalled = true; } };
    }) as any);
    assert.equal(calls[0]?.command, "/opt/herdr");
    assert.deepEqual(calls[0]?.args, ["tab", "close", "w1:t2"]);
    assert.equal(calls[0]?.options.detached, true);
    assert.equal(calls[0]?.options.stdio, "ignore");
    assert.equal(unrefCalled, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("creates unique agent names and readable task-based tab labels", () => {
  assert.deepEqual(makeHerdrNames("Search Agent", "Investigate why subagent panes steal focus", "agent-deadbeef"), {
    agentName: "pi-search-agent-deadbeef",
    tabLabel: "Running search-agent: subagent panes…",
  });
  assert.notEqual(
    makeHerdrNames("search", "Inspect auth", "agent-00000001").agentName,
    makeHerdrNames("search", "Inspect auth", "agent-00000002").agentName,
  );
  assert.equal(makeHerdrNames("librarian", "Research current upstream implementation details", "agent-deadbeef").tabLabel, "Researching: current upstream…");
  assert.ok(makeHerdrNames("librarian", "Research current upstream implementation details", "agent-deadbeef").tabLabel.length <= 40);
});

test("exposes native lifecycle, messaging, permission, and worktree actions", () => {
  const tool = createAgentTool();
  const schema = tool.parameters as any;
  for (const action of ["focus", "message", "approve", "deny", "apply", "retain", "discard"]) {
    assert.equal(schema.properties.action.enum.includes(action), true);
  }
  assert.ok(tool.promptGuidelines.some((line) => line.includes("decision the child can change")));
  assert.ok(tool.promptGuidelines.some((line) => line.includes("Do not ask read-only children")));
});

test("child Pi argv preserves model, trust, allowlist, and unconditional exclusions", () => {
  const base = discoverAgents(process.cwd(), "builtin").agents.find((agent) => agent.name === "search")!;
  const agent = { ...base, tools: undefined, disallowedTools: ["webfetch"] };
  const job: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "search", source: "builtin", task: "inspect $HOME; rm -rf nope", cwd: process.cwd(),
    status: "queued", background: false, backend: "herdr", startedAt: new Date().toISOString(),
  };
  const args = buildChildPiArgs({ job, agent, trusted: false, promptPath: "/tmp/prompt path.md" });
  assert.equal(args.includes("--tools"), false);
  assert.equal(args[args.indexOf("--exclude-tools") + 1], "Agent,edit,webfetch,write");
  assert.equal(args.includes("--no-approve"), true);
  assert.equal(args.at(-1), `Task: ${job.task}`);
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "/tmp/prompt path.md");
});

test("custom extension tools remain in child allowlists", () => {
  const agents = discoverAgents(process.cwd(), "builtin").agents;
  const baseJob: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "librarian", source: "builtin", task: "research", cwd: process.cwd(),
    status: "queued", background: true, backend: "herdr", startedAt: new Date().toISOString(),
  };
  const librarianArgs = buildChildPiArgs({ job: baseJob, agent: agents.find((item) => item.name === "librarian")!, trusted: true, promptPath: "/tmp/prompt" });
  const painterArgs = buildChildPiArgs({ job: { ...baseJob, agent: "painter" }, agent: agents.find((item) => item.name === "painter")!, trusted: true, promptPath: "/tmp/prompt" });
  assert.match(librarianArgs[librarianArgs.indexOf("--tools") + 1], /repo_cache/);
  assert.match(librarianArgs[librarianArgs.indexOf("--tools") + 1], /websearch/);
  assert.match(painterArgs[painterArgs.indexOf("--tools") + 1], /generate_image/);
});

test("project-agent confirmation can decline before any child launches", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-project-agent-"));
  try {
    fs.mkdirSync(path.join(cwd, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".pi", "agents", "local.md"), "---\nname: local\ndescription: local test\n---\nDo work.\n");
    let prompted = false;
    const result = await createAgentTool().execute("call", {
      action: "run", agent: "local", task: "test", agentScope: "project",
    }, undefined, undefined, {
      cwd, hasUI: true,
      ui: { confirm: async () => { prompted = true; return false; }, setStatus: () => undefined },
    } as any);
    assert.equal(prompted, true);
    assert.match(result.content[0].text, /not approved/);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("result formatting includes durable Herdr control metadata", () => {
  const job: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "search", source: "builtin", task: "inspect", cwd: "/tmp",
    status: "running", background: true, backend: "herdr", startedAt: new Date().toISOString(),
    herdr: { agentName: "pi-search-deadbeef", workspaceId: "w1", tabId: "w1:t2", paneId: "w1:p3", terminalId: "term_1" },
  };
  assert.match(formatJobSummary(job), /herdr:pi-search-deadbeef/);
  assert.match(formatJobSummary(job), /w1:t2, pane w1:p3/);
});
