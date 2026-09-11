import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { fixtures, parseFixture, type Fixture } from "./fixtures.ts";
import { columns, renderRows, transcript, type Verbosity } from "./view.ts";

/** Explicit CLI-only render lab. It registers no tools and never starts an agent turn. */
export default function verbosityLab(pi: ExtensionAPI): void {
  pi.registerCommand("verbosity-lab", {
    description: "Compare low and default native Pi rendering. Optional JSON fixture path.",
    async handler(args, ctx) {
      if (ctx.mode !== "tui") return;
      let scenarios: readonly Fixture[] = fixtures;
      if (args.trim()) {
        try {
          const source = await readFile(args.trim(), "utf8");
          if (Buffer.byteLength(source) > 1024 * 1024) throw new Error("Fixture exceeds 1 MiB");
          const decoded: unknown = JSON.parse(source);
          scenarios = [parseFixture(decoded)];
        } catch {
          ctx.ui.notify("Cannot load fixture. Use a valid lab JSON file (at most 1 MiB).", "error");
          return;
        }
      }
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        let selected = 0;
        let step = scenarios[0]?.events.length ?? 0;
        let expanded = false;
        let layout: "compare" | Verbosity = "compare";
        let scroll = 0;
        let previewWidth = 0;
        let cached: { key: string; low: string[]; normal: string[]; lowRows: Component[]; normalRows: Component[] } | undefined;
        let hitRows: { component: Component; start: number; end: number }[] = [];
        let lowWidth = 0;
        let bodyHeight = 0;
        let showLow = true;
        const animation = setInterval(() => tui.requestRender(), 80);
        return {
          dispose() { clearInterval(animation); },
          invalidate() { cached = undefined; },
          handleMouse(event) {
            if (event.type === "wheel") {
              scroll = Math.max(0, scroll + (event.wheelDelta ?? 0));
              tui.requestRender();
              return { handled: true };
            }
            if (!showLow || event.x >= lowWidth || event.y < 3 || event.y >= 3 + bodyHeight) return;
            const line = event.y - 3 + scroll;
            const hit = hitRows.find(row => line >= row.start && line < row.end);
            if (!hit) return;
            const result = hit.component.handleMouse?.({ ...event, y: line - hit.start, width: lowWidth, height: hit.end - hit.start });
            if (result?.handled) tui.requestRender();
            return result;
          },
          handleInput(data) {
            const fixture = scenarios[selected];
            if (!fixture) return;
            if (matchesKey(data, "escape") || data === "q") { done(); return; }
            if (data === "n" || data === "p") {
              selected = (selected + (data === "n" ? 1 : scenarios.length - 1)) % scenarios.length;
              step = scenarios[selected]?.events.length ?? 0; scroll = 0;
            } else if (matchesKey(data, "right")) { step = Math.min(fixture.events.length, step + 1); scroll = 0; }
            else if (matchesKey(data, "left")) { step = Math.max(0, step - 1); scroll = 0; }
            else if (data === "r") { step = 0; scroll = 0; }
            else if (data === "f") { step = fixture.events.length; scroll = 0; }
            else if (data === "e" || matchesKey(data, "ctrl+o")) expanded = !expanded;
            else if (data === "1") { layout = "low"; scroll = 0; }
            else if (data === "2") { layout = "default"; scroll = 0; }
            else if (data === "c") { layout = "compare"; scroll = 0; }
            else if (data === "w") { previewWidth = previewWidth === 0 ? 38 : previewWidth === 38 ? 80 : 0; scroll = 0; }
            else if (matchesKey(data, "down") || data === "j") scroll += 1;
            else if (matchesKey(data, "up") || data === "k") scroll = Math.max(0, scroll - 1);
            else if (matchesKey(data, "pageDown")) scroll += 15;
            else if (matchesKey(data, "pageUp")) scroll = Math.max(0, scroll - 15);
            tui.requestRender();
          },
          render(width) {
            const fixture = scenarios[selected];
            if (!fixture) return [];
            const compare = layout === "compare" && width >= 81;
            const available = compare ? Math.floor((width - 3) / 2) : width;
            const contentWidth = Math.max(1, Math.min(available, previewWidth || available));
            const key = `${selected}:${step}:${expanded}:${contentWidth}`;
            if (cached?.key !== key) cached = {
              key, low: [], normal: [],
              lowRows: transcript(fixture, step, "low", expanded, theme, tui),
              normalRows: transcript(fixture, step, "default", expanded, theme, tui),
            };
            hitRows = [];
            cached.low = cached.lowRows.flatMap(component => {
              const lines = component.render(contentWidth);
              const start = hitRows.at(-1)?.end ?? 0;
              hitRows.push({ component, start, end: start + lines.length });
              return lines;
            });
            cached.normal = renderRows(cached.normalRows, contentWidth);
            lowWidth = contentWidth;
            showLow = compare || layout !== "default";
            const body = compare ? columns(cached.low, cached.normal, width) : layout === "default" ? cached.normal : cached.low;
            const height = Math.max(1, tui.terminal.rows - 7);
            bodyHeight = height;
            scroll = Math.min(scroll, Math.max(0, body.length - height));
            const title = compare ? columns([theme.fg("accent", "LOW · grouped activity")], [theme.fg("accent", "DEFAULT · native Pi")], width)[0] ?? "" : theme.fg("accent", layout === "default" ? "DEFAULT · native Pi" : "LOW · grouped activity");
            return [
              theme.fg("accent", theme.bold(`π Verbosity lab · ${fixture.name}`)),
              theme.fg("muted", `Event ${step}/${fixture.events.length} · ${contentWidth} cols · low ${cached.low.length} lines / default ${cached.normal.length} lines · ${expanded ? "expanded" : "collapsed"}`),
              title,
              ...body.slice(scroll, scroll + height),
              ...Array.from({ length: Math.max(0, height - Math.min(height, body.length - scroll)) }, () => ""),
              theme.fg("dim", "n/p case · ←/→ event · r reset · f finish · e expand · 1/2 level · c compare"),
              theme.fg("dim", `↑/↓ scroll · w width · q close · offline, render-only${layout === "compare" && !compare ? " · narrow: press 2 for default" : ""}`),
            ].map(line => truncateToWidth(line, width));
          },
        };
      }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0 } });
    },
  });
}
