import assert from "node:assert/strict";
import test from "node:test";
import { createBashToolDefinition, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { withVerbosityRendering } from "../adapter.ts";

test("broken native call or result renderers cannot hide original errors in normal mode", () => {
  initTheme("dark", false);
  for (const broken of ["call", "result", "both"]) {
    const original = createBashToolDefinition(process.cwd());
    const fail = () => { throw new Error("renderer failure"); };
    const tool = withVerbosityRendering({ events: { emit() {} } } as never, {
      ...original,
      ...(broken !== "result" ? { renderCall: fail } : {}),
      ...(broken !== "call" ? { renderResult: fail } : {}),
    });
    const row = new ToolExecutionComponent("bash", broken, { command: "false" }, { showImages: false }, tool, { requestRender() {} } as never, process.cwd());
    row.updateResult({ content: [{ type: "text", text: "ORIGINAL_ERROR" }], isError: true });
    for (const expanded of [false, true]) { row.setExpanded(expanded); assert.match(row.render(80).join("\n"), /ORIGINAL_ERROR/); }
  }
});
