import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import verbosityLevel from "../index.ts";
import { InvalidVerbosityError, loadEnabled, parseVerbosity, persistEnabled, statePath } from "../config.ts";

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
  return { ctx, definitions, notifications, commands, listeners, flags,
    setFlag(value: string | boolean | undefined) { flagValue = value; }, flagReads: () => flagReads,
    renders: () => renders,
    event: (name: string, value: unknown = {}) => handlers.get(name)?.(value, ctx) };
}

test("verbosity parser accepts only exact CLI choices", () => {
  for (const value of [undefined, "low", "default"]) assert.equal(parseVerbosity(value), value);
  for (const value of ["", "LOW", " low", "low ", "high", "low normal", true, false, null, 1, {}, []]) {
    assert.ok(parseVerbosity(value) instanceof InvalidVerbosityError);
  }
});

test("CLI verbosity overrides saved state, applies late, and never persists commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-cli-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldEager = process.env.PI_VERBOSITY_BUILTINS;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_VERBOSITY_BUILTINS = "1";
  initTheme("dark", false);
  try {
    for (const verbosity of ["low", "default"]) {
      await persistEnabled(verbosity === "default"); // Deliberately contradict the CLI.
      const before = await readFile(statePath(), "utf8");
      const h = harness();
      assert.equal(h.flags.get("verbosity")?.type, "string");
      assert.equal(h.flags.get("verbosity")?.default, undefined);
      assert.equal(h.flagReads(), 0);
      h.setFlag(verbosity);
      const row = new ToolExecutionComponent("bash", "cli", { command: "git status" }, { showImages: false }, h.definitions.get("bash"), h.ctx.ui as never, tmpdir());
      const lines = () => stripVTControlCharacters(row.render(80).join("\n"));
      const native = lines();
      assert.doesNotMatch(native, /Running \d+ command/);
      await h.event("session_start");
      assert.equal(h.flagReads(), 1);
      await h.event("tool_execution_start", { toolCallId: "cli", toolName: "bash", args: { command: "git status" } });
      if (verbosity === "low") assert.match(lines(), /Running \d+ command/);
      else assert.equal(lines(), native);
      await h.commands.get("verbosity").handler("status", h.ctx);
      assert.match(h.notifications.at(-1) ?? "", new RegExp(`Verbosity ${verbosity}\\. Session only`));
      for (const [command, action, grouped] of [
        ["verbosity", "default", false], ["verbosity", "low", true],
        ["verbosity", "default", false], ["verbosity", "low", true],
      ] as const) {
        await h.commands.get(command).handler(action, h.ctx);
        if (grouped) assert.match(lines(), /Running \d+ command/);
        else assert.equal(lines(), native);
        assert.equal(await readFile(statePath(), "utf8"), before);
      }
      for (const reason of ["reload", "new", "resume", "fork"]) {
        await h.event("session_start", { reason });
        await h.commands.get("verbosity").handler("status", h.ctx);
        assert.match(h.notifications.at(-1) ?? "", new RegExp(`Verbosity ${verbosity}\\.`));
        assert.equal(await readFile(statePath(), "utf8"), before);
      }
      await h.event("session_shutdown");
    }
  } finally {
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    if (oldEager === undefined) delete process.env.PI_VERBOSITY_BUILTINS; else process.env.PI_VERBOSITY_BUILTINS = oldEager;
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicit local opt-out is preserved without creating state, and rejects invalid commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-cli-empty-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldEager = process.env.PI_VERBOSITY_BUILTINS;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_VERBOSITY_BUILTINS = "0";
  try {
    for (const mode of ["tui", "rpc", "json", "print"]) {
      const h = harness(mode);
      h.setFlag("low");
      await h.event("session_start");
      await h.commands.get("verbosity").handler("default", h.ctx);
      await h.commands.get("verbosity").handler("low", h.ctx);
      assert.equal(h.definitions.size, process.env.PI_VERBOSITY_BUILTINS === "0" ? 0 : 7);
      for (const action of ["HIGH", "low normal", "low extra", "status extra"]) {
        await h.commands.get("verbosity").handler(action, h.ctx);
        if (mode === "tui") assert.match(h.notifications.at(-1) ?? "", /Use \/verbosity/);
      }
      await h.commands.get("verbosity").handler("status", h.ctx);
      if (mode === "tui") assert.match(h.notifications.at(-1) ?? "", /Verbosity low\..*\nSupported: none/);
      else assert.deepEqual(h.notifications, []);
      assert.deepEqual(await readdir(dir), []);
      await h.event("session_shutdown");
    }
    const legacy = harness();
    await legacy.event("session_start");
    await legacy.commands.get("verbosity").handler("status", legacy.ctx);
    assert.match(legacy.notifications.at(-1) ?? "", /Verbosity low\. Session only/);
    await legacy.commands.get("verbosity").handler("low", legacy.ctx);
    assert.deepEqual(await readdir(dir), []);
    await legacy.commands.get("verbosity").handler("default", legacy.ctx);
    assert.equal(await loadEnabled(), false);
    await legacy.event("session_shutdown");
  } finally {
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    if (oldEager === undefined) delete process.env.PI_VERBOSITY_BUILTINS; else process.env.PI_VERBOSITY_BUILTINS = oldEager;
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid CLI selection stays disabled despite saved state and commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-cli-invalid-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldEager = process.env.PI_VERBOSITY_BUILTINS;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_VERBOSITY_BUILTINS = "1";
  initTheme("dark", false);
  try {
    await persistEnabled(true);
    const before = await readFile(statePath(), "utf8");
    for (const value of ["", "high", "LOW", "low normal", true]) {
      const h = harness();
      h.setFlag(value);
      await h.event("session_start");
      assert.match(h.notifications.at(-1) ?? "", /Invalid --verbosity/);
      await h.commands.get("verbosity").handler("low", h.ctx);
      await h.commands.get("verbosity").handler("low", h.ctx);
      assert.ok(h.notifications.every(message => message.includes("Invalid --verbosity")));
      await h.event("tool_execution_start", { toolCallId: "invalid", toolName: "bash", args: { command: "git status" } });
      const row = new ToolExecutionComponent("bash", "invalid", { command: "git status" }, { showImages: false }, h.definitions.get("bash"), h.ctx.ui as never, tmpdir());
      assert.doesNotMatch(row.render(80).join("\n"), /Running \d+ command/);
      assert.equal(await readFile(statePath(), "utf8"), before);
      await h.event("session_shutdown");
    }
    await writeFile(statePath(), '{"enabled":"true"}');
    assert.equal(await loadEnabled(), false);
    await writeFile(statePath(), "not json");
    assert.equal(await loadEnabled(), false);
  } finally {
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    if (oldEager === undefined) delete process.env.PI_VERBOSITY_BUILTINS; else process.env.PI_VERBOSITY_BUILTINS = oldEager;
    await rm(dir, { recursive: true, force: true });
  }
});

test("persisted mode defaults off and supports atomic round trips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-state-"));
  try {
    const path = join(dir, "state.json");
    assert.equal(await loadEnabled(path), false);
    await persistEnabled(true, path); assert.equal(await loadEnabled(path), true);
    await persistEnabled(false, path); assert.equal(await loadEnabled(path), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
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

test("eager adapters survive rows constructed before session_start on reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-reload-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldEager = process.env.PI_VERBOSITY_BUILTINS;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_VERBOSITY_BUILTINS = "1";
  initTheme("dark", false);
  try {
    await persistEnabled(true);
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
