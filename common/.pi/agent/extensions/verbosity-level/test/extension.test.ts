import assert from "node:assert/strict";
import { renderersOf } from "./renderers.ts";
import test, { beforeEach, afterEach } from "node:test";
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import { createCodemodeExtension, createBashToolDefinition, createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition, type ToolRenderers, type ToolRendererResolver } from "@earendil-works/pi-coding-agent";
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
  const definitions = new Map<string, ToolRenderers>();
  const registeredTools: ToolDefinition[] = [];
  const resolvers: ToolRendererResolver[] = [];
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
    registerTool(def: ToolDefinition) { registeredTools.push(def); },
    registerToolRenderer(resolver: ToolRendererResolver) { resolvers.push(resolver); },
    getAllTools: () => ["read", "bash", "edit", "write", "grep", "find", "ls"].map(name => ({ name, sourceInfo: { source: owner, path: owner === "builtin" ? fileURLToPath(new URL("../index.ts", import.meta.url)) : "<sdk:tool>" } })),
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerFlag(name: string, options: Parameters<ExtensionAPI["registerFlag"]>[1]) { flags.set(name, options); },
    getFlag() { flagReads++; return flagValue; },
    appendEntry() {},
  };
  verbosityLevel(pi as unknown as ExtensionAPI);
  const resolve = (name: string, base: ToolRenderers | undefined) => {
    const step = (index: number): ToolRenderers | undefined => resolvers[index]?.(name, () => step(index + 1)) ?? base;
    return step(0);
  };
  for (const tool of [createBashToolDefinition(tmpdir()), createReadToolDefinition(tmpdir()), createEditToolDefinition(tmpdir()), createWriteToolDefinition(tmpdir()), createGrepToolDefinition(tmpdir()), createFindToolDefinition(tmpdir()), createLsToolDefinition(tmpdir())]) {
    const renderers = resolve(tool.name, renderersOf(tool));
    if (renderers) definitions.set(tool.name, renderers);
  }
  shutdowns.push(() => handlers.get("session_shutdown")?.({}, ctx));
  return { ctx, definitions, registeredTools, resolve, notifications, commands, listeners, flags,
    setFlag(value: string | boolean | undefined) { flagValue = value; }, flagReads: () => flagReads,
    renders: () => renders,
    event: (name: string, value: unknown = { reason: "startup" }) => handlers.get(name)?.(value, ctx) };
}

function codemodeDefinition(): ToolRenderers {
  let definition: ToolRenderers | undefined;
  // SAFETY: the native factory only registers a tool; execute is never called here.
  createCodemodeExtension({ mode: "on" })({
    registerTool(tool: ToolDefinition) { definition = tool; },
  } as unknown as ExtensionAPI);
  assert.ok(definition);
  return definition;
}

test("codemode summarizes live nested calls, keeps caught errors, expands native output, and restores default", async () => {
  initTheme("dark", false);
  const h = harness();
  await h.event("session_start");
  const base = codemodeDefinition();
  const renderers = h.resolve("codemode", base);
  const args = { code: "const x = await tools.read({path: 'fixture'}); return x;" };
  await h.event("tool_execution_start", { toolCallId: "batch", toolName: "codemode", args });
  const row = new ToolExecutionComponent("codemode", "batch", args, { showImages: false }, renderers, h.ctx.ui as never, tmpdir());
  const native = new ToolExecutionComponent("codemode", "native", args, { showImages: false }, base, h.ctx.ui as never, tmpdir());
  const lines = () => stripVTControlCharacters(row.render(120).join("\n"));
  assert.match(lines(), /Codemode · Running script/);
  const calls = [
    { id: "batch/2", name: "bash", args: "{}", status: "running" },
    { id: "batch/1", name: "read", args: "{}", status: "ok" },
  ];
  const result = { content: [{ type: "text", text: "NATIVE_OUTPUT\n".repeat(20) }], details: { calls }, isError: false };
  await h.event("tool_execution_update", { toolCallId: "batch", partialResult: result });
  row.updateResult(result, true);
  assert.match(lines(), /Codemode · Activity 1 command, 1 read/);
  calls[0]!.status = "error"; // A caught nested failure does not make the script itself fail.
  await h.event("tool_execution_end", { toolCallId: "batch", result, isError: false });
  row.updateResult(result); native.updateResult(result);
  assert.match(lines(), /1 FAILED/);
  assert.doesNotMatch(lines(), /NATIVE_OUTPUT|script FAILED/);
  for (const width of [1, 20, 38, 80]) assert.ok(row.render(width).length);
  const click = { type: "click", button: "left", x: 0, y: 1, screenX: 0, screenY: 1, width: 120, height: 20, shift: false, alt: false, ctrl: false } as const;
  row.handleMouse?.(click);
  assert.match(lines(), /const x/);
  assert.equal(lines().match(/NATIVE_OUTPUT/g)?.length, 20);
  row.setExpanded(true);
  assert.match(lines(), /NATIVE_OUTPUT/);
  row.setExpanded(false);
  assert.doesNotMatch(lines(), /NATIVE_OUTPUT/);
  await h.commands.get("verbosity").handler("default", h.ctx);
  assert.deepEqual(row.render(120), native.render(120));
  assert.equal(h.registeredTools.length, 0);
});

test("codemode failures, cancellation, malformed details, images, and prompts stay visible", async () => {
  initTheme("dark", false);
  for (const scenario of ["failed", "cancelled", "missing", "malformed", "image", "prompt", "empty", "interrupted"]) {
    const h = harness();
    await h.event("session_start");
    const args = { code: "return 'NATIVE_SCRIPT';" };
    await h.event("tool_execution_start", { toolCallId: scenario, toolName: "codemode", args });
    const row = new ToolExecutionComponent("codemode", scenario, args, { showImages: false }, h.resolve("codemode", codemodeDefinition()), h.ctx.ui as never, tmpdir());
    const text = scenario === "cancelled" ? "Operation aborted" : "NATIVE_RESULT";
    const result = {
      content: scenario === "image" ? [{ type: "image", data: "synthetic", mimeType: "image/png" }, { type: "text", text }] : [{ type: "text", text }],
      details: scenario === "missing" ? undefined : scenario === "malformed" ? { calls: [{ name: "read", status: "unknown" }] } : { calls: [] },
      isError: scenario === "failed" || scenario === "cancelled",
    };
    if (scenario === "prompt") await h.event("ui_prompt_start");
    if (scenario === "interrupted") await h.event("agent_settled");
    else {
      await h.event("tool_execution_end", { toolCallId: scenario, result, isError: result.isError });
      row.updateResult(result);
    }
    const output = stripVTControlCharacters(row.render(120).join("\n"));
    if (scenario === "failed") assert.match(output, /script FAILED/);
    else if (scenario === "cancelled") assert.match(output, /script cancelled/);
    else if (scenario === "empty") assert.match(output, /Codemode · Script finished/);
    else assert.match(output, /NATIVE_SCRIPT|NATIVE_RESULT/);
    await h.event("session_shutdown");
  }
});

test("codemode history before reload and tree reconstruction retains its summary and direct-call boundaries", async () => {
  initTheme("dark", false);
  const h = harness();
  const args = { code: "return 'HISTORICAL_SCRIPT';" };
  const result = { content: [{ type: "text", text: "HISTORICAL_RESULT" }], details: { calls: [{ id: "past/1", name: "read", args: "{}", status: "ok" }] }, isError: false };
  const row = new ToolExecutionComponent("codemode", "past", args, { showImages: false }, h.resolve("codemode", codemodeDefinition()), h.ctx.ui as never, tmpdir());
  row.updateResult(result);
  h.ctx.sessionManager.buildContextEntries = (() => [
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "past", name: "codemode", arguments: args }] } },
    { type: "message", message: { role: "toolResult", toolCallId: "past", ...result } },
  ]) as never;
  await h.event("session_start", { reason: "reload" });
  assert.match(row.render(80).join("\n"), /Codemode · Explored 1 read/);
  await h.event("session_tree");
  const replay = new ToolExecutionComponent("codemode", "past", args, { showImages: false }, h.resolve("codemode", codemodeDefinition()), h.ctx.ui as never, tmpdir());
  replay.updateResult(result);
  assert.match(replay.render(80).join("\n"), /Codemode · Explored 1 read/);
  replay.setExpanded(true);
  assert.match(replay.render(80).join("\n"), /HISTORICAL_RESULT/);
});

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
  assert.equal(h.registeredTools.length, 0);
  assert.notEqual(h.definitions.get("read")?.renderShell, "self");
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

test("renderer hook survives rows constructed before session_start on reload", async () => {
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
    assert.equal(h.registeredTools.length, 0);
    assert.equal(h.notifications.length, 0);
  }
  const h = harness("tui", "sdk");
  await h.event("session_start");
  assert.equal(h.registeredTools.length, 0);
});

test("renderer registration supports SDK tool owners without replacing execution or using non-TUI state", async () => {
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
    assert.match(h.notifications[0]!, /Supported: read, bash/);
    assert.equal(h.registeredTools.length, 0);
    await h.event("session_shutdown");
  } finally { delete process.env.PI_VERBOSITY_BUILTINS; }
});
