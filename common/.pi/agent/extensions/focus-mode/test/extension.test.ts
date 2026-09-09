import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { initTheme, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import focusMode from "../index.ts";
import { loadEnabled, persistEnabled } from "../config.ts";

function harness(mode = "tui", owner = "builtin") {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const definitions = new Map<string, ToolDefinition<any, any>>();
  const commands = new Map<string, any>();
  const notifications: string[] = [];
  let renders = 0;
  const ui = { requestRender() { renders++; }, notify(message: string) { notifications.push(message); } };
  const ctx = { mode, cwd: tmpdir(), isProjectTrusted: () => false, ui, sessionManager: { buildContextEntries: () => [], getBranch: () => [], getLeafId: () => undefined } };
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
    getAllTools: () => ["read", "grep", "find", "ls"].map(name => ({ name, sourceInfo: { source: owner } })),
    registerCommand(name: string, command: any) { commands.set(name, command); },
    appendEntry() {},
  };
  focusMode(pi as unknown as ExtensionAPI);
  return { ctx, definitions, notifications, commands, listeners, renders: () => renders,
    event: (name: string, value: unknown = {}) => handlers.get(name)?.(value, ctx) };
}

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
    const h = harness();
    await h.event("session_start");
    assert.equal(h.definitions.size, 4);
    await h.commands.get("focus").handler("on", h.ctx);
    const tools = Array.from({ length: 20 }, (_, i) => ({ type: "toolCall", id: `c${i}`, name: "read", arguments: { path: `${i}.ts` } }));
    const message = { role: "assistant", content: [{ type: "text", text: "Checking files." }, ...tools] };
    await h.event("message_start", { message: { role: "assistant", content: [] } });
    await h.event("message_update", { message });
    const rows = tools.map(t => new ToolExecutionComponent(t.name, t.id, t.arguments, { showImages: false }, h.definitions.get(t.name), h.ctx.ui as never, tmpdir()));
    await h.event("message_end", { message });
    for (const tool of tools) await h.event("tool_execution_start", { toolName: tool.name, toolCallId: tool.id, args: tool.arguments });
    const lines = () => rows.flatMap(row => row.render(90));
    assert.equal(lines().length, 2);
    assert.match(lines()[1]!, /20 running/);
    for (let i = 19; i >= 0; i--) {
      const result = { content: [{ type: "text", text: `result ${i}` }] };
      await h.event("tool_execution_end", { toolCallId: `c${i}`, toolName: "read", result, isError: i === 5 });
      rows[i]!.updateResult({ ...result, isError: i === 5 });
      await h.event("message_end", { message: { role: "toolResult", toolCallId: `c${i}`, ...result, isError: i === 5 } });
    }
    assert.match(lines().join("\n"), /1 FAILED/);
    assert.match(lines().join("\n"), /\/focus details c0/);
    await h.commands.get("focus").handler("off", h.ctx);
    for (const row of rows) row.setExpanded(true);
    assert.match(stripVTControlCharacters(lines().join("\n")), /result 19/);
    for (const row of rows) row.setExpanded(false);
    await h.commands.get("focus").handler("on", h.ctx);
    assert.equal(lines().length, 3); // Failure summary + direct details command.
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
  const oldEager = process.env.PI_FOCUS_BUILTINS;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_FOCUS_BUILTINS = "1";
  initTheme("dark", false);
  try {
    await persistEnabled(true);
    const h = harness();
    const row = new ToolExecutionComponent("read", "history", { path: "history.txt" }, { showImages: false }, h.definitions.get("read"), h.ctx.ui as never, tmpdir());
    row.updateResult({ content: [{ type: "text", text: "original" }], isError: false });
    h.ctx.sessionManager.buildContextEntries = (() => [
      { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "history", name: "read", arguments: { path: "history.txt" } }] } },
      { type: "message", message: { role: "toolResult", toolCallId: "history", content: [{ type: "text", text: "original" }], isError: false } },
    ]) as never;
    await h.event("session_start", { reason: "reload" });
    assert.match(row.render(80).join("\n"), /Explored · 1 read/);
    await h.event("session_shutdown");
  } finally {
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    if (oldEager === undefined) delete process.env.PI_FOCUS_BUILTINS; else process.env.PI_FOCUS_BUILTINS = oldEager;
    await rm(dir, { recursive: true, force: true });
  }
});

test("non-TUI modes do not register overrides or emit UI; extension-owned tools are not replaced", async () => {
  for (const mode of ["rpc", "json", "print"]) {
    const h = harness(mode);
    await h.event("session_start");
    await h.commands.get("focus").handler("on", h.ctx);
    await h.event("tool_execution_start", { toolCallId: "c", toolName: "read", args: {} });
    assert.equal(h.definitions.size, 0);
    assert.equal(h.notifications.length, 0);
  }
  const h = harness("tui", "sdk");
  await h.event("session_start");
  assert.equal(h.definitions.size, 0);
});
