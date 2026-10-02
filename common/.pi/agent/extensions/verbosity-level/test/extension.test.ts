import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import verbosityLevel from "../index.ts";
import { InvalidVerbosityError, loadVerbosity, parseVerbosity, persistVerbosity, statePath, VerbosityStateError } from "../config.ts";

const execFileAsync = promisify(execFile);
const shutdowns: Array<() => unknown> = [];
let testDir: string;
const originalDir = process.env.PI_CODING_AGENT_DIR;
const originalEager = process.env.PI_VERBOSITY_BUILTINS;
beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "verbosity-test-"));
  process.env.PI_CODING_AGENT_DIR = testDir;
});
afterEach(async () => {
  for (const shutdown of shutdowns.splice(0)) await shutdown();
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
  if (originalEager === undefined) delete process.env.PI_VERBOSITY_BUILTINS;
  else process.env.PI_VERBOSITY_BUILTINS = originalEager;
  await rm(testDir, { recursive: true, force: true });
});

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for cross-session synchronization");
    await delay(25);
  }
}

function harness(mode = "tui", owner = "builtin") {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const definitions = new Map<string, ToolDefinition<any, any>>();
  const commands = new Map<string, any>();
  const notifications: string[] = [];
  const flags = new Map<string, Parameters<ExtensionAPI["registerFlag"]>[1]>();
  let flagValue: string | boolean | undefined;
  let flagReads = 0;
  let renders = 0;
  const ui = { requestRender() { renders++; }, notify(message: string) { notifications.push(message); } };
  const ctx = { mode, hasUI: mode === "tui" || mode === "rpc", cwd: tmpdir(), isProjectTrusted: () => false, ui, sessionManager: { buildContextEntries: () => [], getBranch: () => [], getLeafId: () => undefined } };
  const pi = {
    on(name: string, handler: any) { handlers.set(name, handler); },
    events: {
      on(name: string, listener: (value: unknown) => void) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(listener);
        return () => listeners.get(name)!.delete(listener);
      },
      emit(name: string, value: unknown) { for (const listener of listeners.get(name) ?? []) listener(value); },
    },
    registerTool(def: ToolDefinition<any, any>) { definitions.set(def.name, def); },
    getAllTools: () => ["read", "bash", "edit", "write", "grep", "find", "ls"].map(name => ({ name, sourceInfo: { source: owner, path: owner === "builtin" ? fileURLToPath(new URL("../index.ts", import.meta.url)) : "<sdk:tool>" } })),
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerFlag(name: string, options: Parameters<ExtensionAPI["registerFlag"]>[1]) { flags.set(name, options); },
    getFlag() { flagReads++; return flagValue; },
    appendEntry() {},
  };
  verbosityLevel(pi as unknown as ExtensionAPI);
  shutdowns.push(() => handlers.get("session_shutdown")?.({}, ctx));
  return { ctx, definitions, notifications, commands, listeners, flags,
    setFlag(value: string | boolean | undefined) { flagValue = value; }, flagReads: () => flagReads,
    renders: () => renders,
    event: (name: string, value: unknown = { reason: "startup" }) => handlers.get(name)?.(value, ctx) };
}

test("verbosity parser accepts only exact CLI choices", () => {
  for (const value of [undefined, "low", "default"]) assert.equal(parseVerbosity(value), value);
  for (const value of ["", "LOW", " low", "low ", "high", "low normal", true, false, null, 1, {}, []]) {
    assert.ok(parseVerbosity(value) instanceof InvalidVerbosityError);
  }
});

test("CLI selection saves globally once; commands survive session changes and restart", async () => {
  for (const verbosity of ["low", "default"] as const) {
    assert.equal(persistVerbosity(verbosity === "low" ? "default" : "low"), undefined);
    const h = harness();
    assert.equal(h.flags.get("verbosity")?.type, "string");
    assert.equal(h.flags.get("verbosity")?.default, undefined);
    assert.equal(h.flagReads(), 0);
    h.setFlag(verbosity);
    await h.event("session_start");
    assert.equal(h.flagReads(), 1);
    assert.equal(loadVerbosity(), verbosity);
    const next = verbosity === "low" ? "default" : "low";
    await h.commands.get("verbosity").handler(next, h.ctx);
    for (const reason of ["new", "resume", "fork"]) {
      await h.event("session_start", { reason });
      await h.commands.get("verbosity").handler("status", h.ctx);
      assert.ok(h.notifications.at(-1)?.startsWith(`Verbosity ${next}. Global`));
      assert.equal(loadVerbosity(), next);
    }
    await h.event("session_shutdown");
    const reloaded = harness();
    reloaded.setFlag(verbosity);
    await reloaded.event("session_start", { reason: "reload" });
    assert.equal(loadVerbosity(), next);
    await reloaded.commands.get("verbosity").handler("status", reloaded.ctx);
    assert.ok(reloaded.notifications.at(-1)?.startsWith(`Verbosity ${next}. Global`));
    await reloaded.event("session_shutdown");
    const restarted = harness();
    await restarted.event("session_start");
    await restarted.commands.get("verbosity").handler("status", restarted.ctx);
    assert.ok(restarted.notifications.at(-1)?.startsWith(`Verbosity ${next}. Global`));
    await restarted.event("session_shutdown");
  }
});

test("open sessions sync both ways, redraw rows, and stop watching on shutdown", async () => {
  initTheme("dark", false);
  const first = harness();
  const second = harness();
  second.ctx.cwd = join(tmpdir(), "another-project");
  for (const h of [first, second]) {
    await h.event("session_start");
    await h.event("tool_execution_start", { toolCallId: "sync", toolName: "bash", args: { command: "git status" } });
    await h.event("tool_execution_end", { toolCallId: "sync", result: { content: [{ type: "text", text: "clean" }] }, isError: false });
  }
  const row = new ToolExecutionComponent("bash", "sync", { command: "git status" }, { showImages: false }, second.definitions.get("bash"), second.ctx.ui as never, tmpdir());
  row.updateResult({ content: [{ type: "text", text: "clean" }], isError: false });
  const lines = () => stripVTControlCharacters(row.render(80).join("\n"));
  assert.match(lines(), /Ran 1 command/);
  await first.commands.get("verbosity").handler("default", first.ctx);
  await waitFor(() => !/Ran 1 command/.test(lines()));
  assert.equal(loadVerbosity(), "default");
  const before = second.renders();
  // A separate process uses the real adapter, not the extension event bus.
  await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { persistVerbosity } from ${JSON.stringify(new URL("../config.ts", import.meta.url).href)}; if (persistVerbosity("low")) process.exit(1);`,
  ], { cwd: fileURLToPath(new URL("..", import.meta.url)) });
  await waitFor(() => /Ran 1 command/.test(lines()));
  assert.ok(second.renders() > before);
  await first.commands.get("verbosity").handler("status", first.ctx);
  assert.match(first.notifications.at(-1) ?? "", /Verbosity low/);
  await first.event("session_shutdown");
  await second.event("session_shutdown");
  const stoppedRenders = second.renders();
  assert.equal(persistVerbosity("default"), undefined);
  await delay(600);
  assert.equal(second.renders(), stoppedRenders);
});

test("first run uses low without writing; local opt-out preserves global commands", async () => {
  process.env.PI_VERBOSITY_BUILTINS = "0";
  const h = harness();
  await h.event("session_start");
  await h.commands.get("verbosity").handler("status", h.ctx);
  assert.match(h.notifications.at(-1) ?? "", /Verbosity low/);
  assert.deepEqual(await readdir(testDir), []);
  assert.equal(h.definitions.size, 0);
  for (const action of ["HIGH", "low normal", "low extra", "status extra"]) {
    await h.commands.get("verbosity").handler(action, h.ctx);
    assert.match(h.notifications.at(-1) ?? "", /Use \/verbosity/);
  }
  assert.equal(loadVerbosity(), undefined);
  await h.commands.get("verbosity").handler("default", h.ctx);
  assert.equal(loadVerbosity(), "default");
});

test("non-TUI modes do not read or write global state, even with CLI selection", async () => {
  await writeFile(statePath(), "not json");
  for (const mode of ["rpc", "json", "print"]) {
    const h = harness(mode);
    h.setFlag("low");
    await h.event("session_start");
    await h.commands.get("verbosity").handler("default", h.ctx);
    assert.deepEqual(h.notifications, []);
    assert.equal(await readFile(statePath(), "utf8"), "not json");
  }
});

test("invalid CLI selection stays disabled despite saved state and commands", async () => {
  assert.equal(persistVerbosity("low"), undefined);
  const before = await readFile(statePath(), "utf8");
  for (const value of ["", "high", "LOW", "low normal", true]) {
    const h = harness();
    h.setFlag(value);
    await h.event("session_start");
    await h.commands.get("verbosity").handler("low", h.ctx);
    assert.ok(h.notifications.every(message => message.includes("Invalid --verbosity")));
    assert.equal(await readFile(statePath(), "utf8"), before);
  }
});

test("state parses strictly and writes atomically with private permissions", async () => {
  const path = statePath();
  assert.equal(loadVerbosity(), undefined);
  for (const verbosity of ["default", "low"] as const) {
    assert.equal(persistVerbosity(verbosity), undefined);
    assert.equal(loadVerbosity(), verbosity);
  }
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dirname(path)), ["verbosity.local.json"]);
  for (const contents of ["not json", "null", "{}", '{"verbosity":true}', '{"verbosity":"HIGH"}']) {
    await writeFile(path, contents);
    assert.ok(loadVerbosity() instanceof VerbosityStateError);
  }
});

test("read and save failures are visible and never claim a successful change", async () => {
  await writeFile(statePath(), "not json");
  const h = harness();
  await h.event("session_start");
  assert.match(h.notifications.at(-1) ?? "", /Cannot read global verbosity/);
  await h.commands.get("verbosity").handler("low", h.ctx);
  assert.equal(loadVerbosity(), "low");
  await rm(statePath());
  await mkdir(statePath()); // Deterministic failure even when tests run as root.
  h.notifications.length = 0;
  await h.commands.get("verbosity").handler("default", h.ctx);
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0] ?? "", /Cannot save global verbosity/);
  await h.commands.get("verbosity").handler("status", h.ctx);
  assert.match(h.notifications.at(-1) ?? "", /Verbosity low/);
});

test("live extension events keep source order, progress, mode switching, and disposal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-live-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  initTheme("dark", false);
  try {
    process.env.PI_VERBOSITY_BUILTINS = "1";
    const h = harness();
    delete process.env.PI_VERBOSITY_BUILTINS;
    await h.event("session_start");
    assert.equal(h.definitions.size, 7);
    await h.commands.get("verbosity").handler("low", h.ctx);
    const tools = Array.from({ length: 20 }, (_, i) => ({ type: "toolCall", id: `c${i}`, name: "read", arguments: { path: `${i}.ts` } }));
    const message = { role: "assistant", content: [{ type: "text", text: "Checking files." }, ...tools] };
    await h.event("message_start", { message: { role: "assistant", content: [] } });
    await h.event("message_update", { message });
    const rows = tools.map(t => new ToolExecutionComponent(t.name, t.id, t.arguments, { showImages: false }, h.definitions.get(t.name), h.ctx.ui as never, tmpdir()));
    await h.event("message_end", { message });
    for (const tool of tools) await h.event("tool_execution_start", { toolName: tool.name, toolCallId: tool.id, args: tool.arguments });
    const lines = () => rows.flatMap(row => row.render(90));
    assert.equal(lines().length, 2);
    assert.match(lines()[1]!, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Exploring 20 reads/);
    for (let i = 19; i >= 0; i--) {
      const result = { content: [{ type: "text", text: `result ${i}` }] };
      await h.event("tool_execution_end", { toolCallId: `c${i}`, toolName: "read", result, isError: i === 5 });
      rows[i]!.updateResult({ ...result, isError: i === 5 });
      await h.event("message_end", { message: { role: "toolResult", toolCallId: `c${i}`, ...result, isError: i === 5 } });
    }
    assert.match(lines().join("\n"), /1 FAILED/);
    assert.doesNotMatch(lines().join("\n"), /\/focus/);
    assert.equal(h.commands.has("focus"), false);
    await h.commands.get("verbosity").handler("default", h.ctx);
    for (const row of rows) row.setExpanded(true);
    assert.match(stripVTControlCharacters(lines().join("\n")), /result 19/);
    for (const row of rows) row.setExpanded(false);
    await h.commands.get("verbosity").handler("low", h.ctx);
    assert.equal(lines().length, 2); // Spacer and failure summary, no legacy command.
    await h.event("session_shutdown");
    assert.ok([...h.listeners.values()].every(set => set.size === 0));
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});

test("streamed thinking keeps each tool batch at its own transcript position", async () => {
  const oldEager = process.env.PI_VERBOSITY_BUILTINS;
  process.env.PI_VERBOSITY_BUILTINS = "1";
  initTheme("dark", false);
  const h = harness();
  try {
    await h.event("session_start");
    const rows: ToolExecutionComponent[] = [];
    for (let batch = 0; batch < 3; batch++) {
      const thinking = { type: "thinking", thinking: "" };
      const tools = [0, 1].map(index => ({ type: "toolCall", id: `${batch}-${index}`, name: "read", arguments: { path: `${batch}-${index}.ts` } }));
      await h.event("message_start", { message: { role: "assistant", content: [] } });
      // Empty thinking starts a boundary. Repeated deltas must not split siblings.
      await h.event("message_update", { message: { role: "assistant", content: [thinking] } });
      thinking.thinking = "Check another pair.";
      await h.event("message_update", { message: { role: "assistant", content: [thinking, tools[0]] } });
      const message = { role: "assistant", content: [thinking, ...tools] };
      await h.event("message_update", { message });
      await h.event("message_update", { message });
      await h.event("message_end", { message });
      for (const tool of tools) {
        const row = new ToolExecutionComponent(tool.name, tool.id, tool.arguments, { showImages: false }, h.definitions.get(tool.name), h.ctx.ui as never, tmpdir());
        rows.push(row);
        await h.event("tool_execution_start", { toolName: tool.name, toolCallId: tool.id, args: tool.arguments });
        const result = { content: [{ type: "text", text: "ok" }], isError: false };
        await h.event("tool_execution_end", { toolCallId: tool.id, result, isError: false });
        row.updateResult(result);
      }
    }
    for (const [index, row] of rows.entries()) {
      const lines = stripVTControlCharacters(row.render(80).join("\n"));
      if (index % 2 === 0) assert.match(lines, /Explored 2 reads/);
      else assert.equal(lines, "");
    }
  } finally {
    await h.event("session_shutdown");
    if (oldEager === undefined) delete process.env.PI_VERBOSITY_BUILTINS; else process.env.PI_VERBOSITY_BUILTINS = oldEager;
  }
});

test("nested codemode calls do not hide the next direct tool row", async () => {
  const oldEager = process.env.PI_VERBOSITY_BUILTINS;
  process.env.PI_VERBOSITY_BUILTINS = "1";
  initTheme("dark", false);
  const h = harness();
  try {
    await h.event("session_start");
    await h.event("tool_execution_start", { toolCallId: "batch", toolName: "codemode", args: {} });
    const nested = { toolCallId: "batch/1", parentToolCallId: "batch", toolName: "read" };
    await h.event("tool_execution_start", { ...nested, args: { path: "nested.ts" } });
    await h.event("tool_execution_update", { ...nested, partialResult: { content: [{ type: "text", text: "partial" }] } });
    await h.event("tool_execution_end", { ...nested, result: { content: [{ type: "text", text: "ok" }] }, isError: false });
    const args = { path: "direct.ts" };
    await h.event("tool_execution_start", { toolCallId: "direct", toolName: "read", args });
    const row = new ToolExecutionComponent("read", "direct", args, { showImages: false }, h.definitions.get("read"), h.ctx.ui as never, tmpdir());
    assert.match(stripVTControlCharacters(row.render(80).join("\n")), /Exploring 1 read/);
  } finally {
    await h.event("session_shutdown");
    if (oldEager === undefined) delete process.env.PI_VERBOSITY_BUILTINS; else process.env.PI_VERBOSITY_BUILTINS = oldEager;
  }
});

test("eager adapters survive rows constructed before session_start on reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-reload-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldEager = process.env.PI_VERBOSITY_BUILTINS;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_VERBOSITY_BUILTINS = "1";
  initTheme("dark", false);
  try {
    assert.equal(persistVerbosity("low"), undefined);
    const h = harness();
    const row = new ToolExecutionComponent("bash", "history", { command: "git status" }, { showImages: false }, h.definitions.get("bash"), h.ctx.ui as never, tmpdir());
    row.updateResult({ content: [{ type: "text", text: "original" }], isError: false });
    h.ctx.sessionManager.buildContextEntries = (() => [
      { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "history", name: "bash", arguments: { command: "git status" } }] } },
      { type: "message", message: { role: "toolResult", toolCallId: "history", content: [{ type: "text", text: "original" }], isError: false } },
    ]) as never;
    await h.event("session_start", { reason: "reload" });
    assert.match(row.render(80).join("\n"), /Ran 1 command/);
    await h.event("session_shutdown");
  } finally {
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    if (oldEager === undefined) delete process.env.PI_VERBOSITY_BUILTINS; else process.env.PI_VERBOSITY_BUILTINS = oldEager;
    await rm(dir, { recursive: true, force: true });
  }
});

test("non-TUI modes do not register overrides or emit UI; extension-owned tools are not replaced", async () => {
  for (const mode of ["rpc", "json", "print"]) {
    const h = harness(mode);
    await h.event("session_start");
    await h.commands.get("verbosity").handler("low", h.ctx);
    await h.event("tool_execution_start", { toolCallId: "c", toolName: "read", args: {} });
    assert.equal(h.definitions.size, process.env.PI_VERBOSITY_BUILTINS === "0" ? 0 : 7);
    assert.equal(h.notifications.length, 0);
  }
  const h = harness("tui", "sdk");
  await h.event("session_start");
  assert.equal(h.definitions.size, process.env.PI_VERBOSITY_BUILTINS === "0" ? 0 : 7);
});

test("eager registration does not group competing owners or use UI in non-TUI modes", async () => {
  process.env.PI_VERBOSITY_BUILTINS = "1";
  try {
    for (const mode of ["rpc", "json", "print"]) {
      const h = harness(mode);
      assert.equal(h.definitions.size, 7);
      await h.event("session_start");
      await h.commands.get("verbosity").handler("low", h.ctx);
      assert.equal(h.notifications.length, 0);
      await h.event("session_shutdown");
    }
    const h = harness("tui", "sdk");
    await h.event("session_start");
    await h.commands.get("verbosity").handler("status", h.ctx);
    assert.match(h.notifications[0]!, /Supported: none/);
    await h.event("session_shutdown");
  } finally { delete process.env.PI_VERBOSITY_BUILTINS; }
});
