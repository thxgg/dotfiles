import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import subagents from "../../../extensions/subagents/index.ts";
import workflows from "../../../extensions/workflows/index.ts";
import { announceFocusTools, withFocusRendering, DISCOVER_EVENT, RENDER_EVENT, type RenderRequest } from "../adapter.ts";
import { Activity } from "../model.ts";
import { activityComponent } from "../render.ts";

test("explicit archived adapters group Agent and workflow and dispose discovery", async () => {
  initTheme("dark", false);
  for (const [factory, name, owner] of [[subagents, "Agent", "subagents"], [workflows, "workflow", "workflows"]] as const) {
    const definitions = new Map<string, any>();
    const listeners = new Map<string, Set<(value: any) => void>>();
    const handlers = new Map<string, (event: any, ctx: any) => unknown>();
    let wrongOwner = false;
    const pi = {
      registerTool(tool: any) { definitions.set(tool.name, tool); }, registerCommand() {}, registerMessageRenderer() {},
      on(event: string, handler: any) { handlers.set(event, handler); },
      getAllTools() { return [...definitions.keys()].map(name => ({ name, sourceInfo: { path: wrongOwner ? "<sdk:replacement>" : fileURLToPath(new URL(`../../../extensions/${owner}/index.ts`, import.meta.url)) } })); },
      events: {
        on(event: string, handler: any) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(handler); return () => listeners.get(event)!.delete(handler); },
        emit(event: string, value: any) { for (const handler of listeners.get(event) ?? []) handler(value); },
      },
    };
    await factory(pi as never);
    const original = definitions.get(name);
    assert.notEqual(original.renderShell, "self");
    definitions.set(name, withFocusRendering(pi as never, original));
    const dispose = announceFocusTools(pi as never, [name], new URL(`../../../extensions/${owner}/index.ts`, import.meta.url).href);
    const discovery = { names: new Set<string>() };
    pi.events.emit(DISCOVER_EVENT, discovery);
    assert.deepEqual([...discovery.names], [name]);
    wrongOwner = true;
    const collision = { names: new Set<string>() }; pi.events.emit(DISCOVER_EVENT, collision);
    assert.equal(collision.names.size, 0);
    const activity = new Activity(discovery.names);
    const tool = definitions.get(name);
    const ui = { requestRender() {} };
    const args = name === "workflow" ? { script: "const =" } : { action: "list" };
    const result = { content: [{ type: "text" as const, text: "OWNER_ORIGINAL_RESULT" }], details: undefined, isError: false };
    const normal = new ToolExecutionComponent(name, "normal", args, { showImages: false }, tool, ui as never, tmpdir());
    normal.updateResult(result);
    pi.events.on(RENDER_EVENT, (request: RenderRequest) => { request.component = activityComponent(activity, request, () => true); });
    activity.start("first", name, args); activity.finish("first", result);
    activity.start("second", name, args); activity.finish("second", result);
    const rows = ["first", "second"].map(id => {
      const row = new ToolExecutionComponent(name, id, args, { showImages: false }, tool, ui as never, tmpdir());
      row.updateResult(result); return row;
    });
    assert.match(rows[0]!.render(80).join("\n"), /Activity/);
    assert.equal(rows[1]!.render(80).length, 0);
    for (const row of rows) row.setExpanded(true);
    assert.match(rows[1]!.render(80).join("\n"), /OWNER_ORIGINAL_RESULT/);
    await handlers.get("session_shutdown")?.({ reason: "reload" }, {});
    dispose();
    assert.equal(listeners.get(DISCOVER_EVENT)?.size, 0);
  }
});
