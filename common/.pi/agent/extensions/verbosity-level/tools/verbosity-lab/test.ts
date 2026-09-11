import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { TuiMainScreen, ProcessTerminal, visibleWidth } from "@earendil-works/pi-tui";
import { fixtures, parseFixture } from "./fixtures.ts";
import { columns, renderRows, transcript } from "./view.ts";

/** Offline checks through Pi's real package loader. No terminal is started. */
export default function tests(pi: ExtensionAPI): void {
  pi.registerCommand("test-verbosity-lab", {
    description: "Run offline native-renderer assertions",
    async handler(_args, ctx) {
      initTheme("light");
      const tui = new TuiMainScreen(new ProcessTerminal());
      const theme = ctx.ui.theme;
      for (const fixture of fixtures) {
        assert.deepEqual(parseFixture(JSON.parse(JSON.stringify(fixture))), fixture);
        for (const width of [20, 38, 80, 120]) {
          for (let step = 0; step <= fixture.events.length; step++) {
            for (const expanded of [false, true]) {
              for (const level of ["low", "default"] as const) {
                const lines = renderRows(transcript(fixture, step, level, expanded, theme, tui), width);
                assert(lines.every(line => visibleWidth(line) <= width), `${fixture.name}: ${level} exceeds ${width}`);
              }
            }
          }
        }
      }
      const first = fixtures[0];
      assert(first);
      const low = renderRows(transcript(first, first.events.length, "low", false, theme, tui), 80);
      const normal = renderRows(transcript(first, first.events.length, "default", false, theme, tui), 80);
      assert(low.length < normal.length);
      const clickable = transcript(first, first.events.length, "low", false, theme, tui);
      const header = clickable.find(row => row.render(80).some(line => line.includes("Explored")));
      assert(header);
      assert.equal(header.render(80)[0], "", "Standalone summaries retain Pi's top spacer");
      const before = header.render(80).length;
      assert(header.handleMouse?.({ type: "click", button: "left", x: 2, y: 1, screenX: 2, screenY: 1, width: 80, height: 2, shift: false, alt: false, ctrl: false })?.handled);
      assert(header.render(80).length > before);
      assert(!header.render(80).join("\n").includes("/focus details"));
      assert.match(header.render(80).join("\n"), /▾ Explored/);
      assert.doesNotMatch(header.render(80).join("\n"), /✓ Read/);
      const opened = header.render(80).length;
      header.handleMouse?.({ type: "click", button: "left", x: 2, y: 4, screenX: 2, screenY: 4, width: 80, height: opened, shift: false, alt: false, ctrl: false });
      assert.match(header.render(80).join("\n"), /▾ Explored/);
      assert(header.render(80).length >= opened);
      header.handleMouse?.({ type: "click", button: "left", x: 2, y: 1, screenX: 2, screenY: 1, width: 80, height: opened, shift: false, alt: false, ctrl: false });
      assert.equal(header.render(80).length, before);
      assert(!low.join("\n").includes("completed"));
      assert(low.join("\n").includes("Explored"));
      assert(normal.join("\n").includes("npm test"));
      assert(columns(low, normal, 163).every(line => visibleWidth(line) <= 163));
      for (const fixture of fixtures.filter(item => item.name.startsWith("WIP"))) {
        const calls = fixture.events.filter(event => event.type === "call");
        const results = fixture.events.filter(event => event.type === "result");
        assert(calls.length > results.length, "WIP fixtures must retain unfinished calls");
        const rendered = renderRows(transcript(fixture, fixture.events.length, "low", false, theme, tui), 80).join("\n");
        assert.match(rendered, /▸ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
        if (fixture.name.includes("web searches")) assert.match(rendered, /Exploring 3 web searches, 1 fetch/);
      }
      const failure = fixtures[1];
      assert(failure);
      const failed = renderRows(transcript(failure, failure.events.length, "low", false, theme, tui), 80).join("\n");
      assert(failed.includes("FAILED"));
      assert(failed.includes("cancelled"));
      const unsupported = fixtures[2];
      assert(unsupported);
      assert(renderRows(transcript(unsupported, unsupported.events.length, "low", false, theme, tui), 80).join("\n").includes("Unsupported tools keep normal rows"));
      assert.deepEqual(parseFixture({ name: "safe", events: [{ type: "call", id: "x", name: "bash", args: { command: "echo\u001b[31m", nested: ["\u009b"] } }] }).events,
        [{ type: "call", id: "x", name: "bash", args: { command: "echo[31m", nested: [""] } }]);
      assert.throws(() => parseFixture({ name: "bad", events: [{ type: "mystery" }] }));
      assert.throws(() => parseFixture({ name: "bad", events: [{ type: "result", id: "missing", text: "", error: false }] }));
      assert.throws(() => parseFixture({ name: "bad", events: [
        { type: "call", id: "same", name: "bash", args: {} }, { type: "call", id: "same", name: "bash", args: {} },
      ] }));
      tui.stop();
      console.log("VERBOSITY_LAB_TESTS_PASSED");
    },
  });
}
