import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Marked, type Component, type TUI, type TuiMouseEvent, type MarkdownOptions, type MarkdownTheme, type DefaultTextStyle } from "@earendil-works/pi-tui";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Local adaptation of ChmaraX/pi-centered 0.1.0 (see LICENSE).
// Centers Pi's transcript, editor and footer in a column of at most `maxWidth` cells.
// Diagrams use the terminal width budget and are centered independently. Diagrams
// that cannot render at that width stay as source inside the normal text column.
//
//   /maxwidth 120   set width (saved)
//   /maxwidth off   full width (saved)
//   /maxwidth       show current
//
// Width priority: PI_CENTERED_WIDTH env var > saved value (<agent dir>/pi-centered.json) > 110.
// Regression checks: common/.pi/test/centered-layout.test.mjs

const DEFAULT_WIDTH = 110;
const MIN_WIDTH = 20;
const CONFIG = join(getAgentDir(), "pi-centered.json");

/** 0 means off. Returns undefined for anything that is not 0 or an integer >= MIN_WIDTH. */
function parseWidth(value: unknown): number | undefined {
	const n = value === "off" ? 0 : typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	return typeof n === "number" && Number.isInteger(n) && (n === 0 || n >= MIN_WIDTH) ? n : undefined;
}

const label = (width: number) => (width ? `Max width: ${width}` : "Max width: off");

function loadSaved(): number | undefined {
	try {
		return parseWidth(JSON.parse(readFileSync(CONFIG, "utf8")).maxWidth);
	} catch {
		return undefined;
	}
}

// ---------- Hooks (installed once per component, survive /reload) ----------
//
// Each Pi component gets thin trampolines that call whatever `state.impl` currently is.
// Every extension load installs its own impl, and session_shutdown removes it, so
// editing or removing this file takes effect on /reload.

type Render = (width: number) => string[];
type HandleMouse = NonNullable<Component["handleMouse"]>;
type HookedComponent = Component & { [HOOKED]?: boolean; [PARTS]?: { key: string; parts: Part[] | null } };
interface Impl {
	render(comp: HookedComponent, width: number, render: Render): string[];
	handleMouse(comp: HookedComponent, event: TuiMouseEvent, handleMouse: HandleMouse): ReturnType<HandleMouse>;
}

// Keep the upstream key so existing trampolines switch implementations on /reload.
// This is the only global state boundary; Pi keeps its components across reloads.
const globalState = globalThis as typeof globalThis & {
	[key: symbol]: { impl?: Impl; tui?: TUI } | undefined;
};
const state = (globalState[Symbol.for("pi-centered.state.v2")] ??= {});
const HOOKED = Symbol.for("pi-centered.hooked.v2");
const PARTS = Symbol.for("pi-centered.parts.v2");

function hook(comp: HookedComponent) {
	if (!comp || comp[HOOKED] || typeof comp.render !== "function") return;
	comp[HOOKED] = true;
	const render: Render = comp.render.bind(comp);
	comp.render = (width: number) => (state.impl ? state.impl.render(comp, width, render) : render(width));
	if (typeof comp.handleMouse === "function") {
		const handleMouse: HandleMouse = comp.handleMouse.bind(comp);
		comp.handleMouse = (event: TuiMouseEvent) =>
			state.impl ? state.impl.handleMouse(comp, event, handleMouse) : handleMouse(event);
	}
	if (typeof comp.invalidate === "function") {
		const invalidate = comp.invalidate.bind(comp);
		comp.invalidate = () => {
			delete comp[PARTS]; // theme or mermaid-mode change: rebuild split parts
			invalidate();
		};
	}
}

// ---------- Column geometry ----------

let maxWidth = DEFAULT_WIDTH;

/** Column for content that needs `need` cells (0 = normal text). */
function column(width: number, need = 0): { w: number; pad: number } {
	if (!maxWidth) return { w: width, pad: 0 };
	const w = Math.min(width, need || maxWidth);
	return { w, pad: Math.floor((width - w) / 2) };
}

const OSC_PREFIX = /^(?:\x1b\]133;[A-Z]\x07)*/;

function indent(lines: string[], pad: number): string[] {
	if (!pad) return lines;
	const spaces = " ".repeat(pad);
	return lines.map((line) => {
		const osc = line.match(OSC_PREFIX)![0]; // prompt-zone markers stay at column 0
		return osc + spaces + line.slice(osc.length);
	});
}

// ---------- Mermaid breakout ----------

let renderMermaid: ((src: string) => { width: number } | undefined) | undefined;

async function loadMermaid(): Promise<boolean> {
	if (renderMermaid) return true;
	try {
		// grok-mermaid is Pi's own dependency; resolve it from Pi's install.
		const req = createRequire(realpathSync(process.argv[1]!));
		const mod = await import(pathToFileURL(req.resolve("grok-mermaid")).href);
		if (typeof mod.render === "function") renderMermaid = mod.render;
	} catch {}
	return !!renderMermaid;
}

const artWidths = new Map<string, number>();

function artWidth(src: string): number {
	let width = artWidths.get(src);
	if (width === undefined) {
		try {
			width = renderMermaid?.(src)?.width ?? 0;
		} catch {
			width = 0;
		}
		if (artWidths.size > 200) artWidths.clear();
		artWidths.set(src, width);
	}
	return width;
}

/** Same test Pi uses (components/mermaid.js). */
function isMermaid(token: { type: string; lang?: string }): token is { type: "code"; lang: string; text: string; raw: string } {
	return token.type === "code" && token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid";
}

/** Ask Pi's own transform pipeline whether it would draw this block at `width` (mermaid mode, streaming). */
function piWillDraw(md: MarkdownState, raw: string, width: number): boolean {
	const transform = md.options?.transform;
	if (typeof transform !== "function") return false;
	const out = transform(raw, width);
	return typeof out === "string" && !out.trimStart().startsWith(raw.trim());
}

type Part = { md: Markdown; need: number }; // need 0 = column width

// Pi 1.4.0 has no public getter for these Markdown fields. Keep the private API
// dependency at this boundary and fall back to native rendering if its shape changes.
type MarkdownState = {
	text: string;
	paddingX: number;
	paddingY: number;
	theme: MarkdownTheme;
	defaultTextStyle?: DefaultTextStyle;
	options: MarkdownOptions;
};

function markdownState(md: Markdown): MarkdownState | undefined {
	const value = md as unknown as Partial<MarkdownState>;
	if (typeof value.text !== "string" || typeof value.paddingX !== "number" ||
		typeof value.paddingY !== "number" || !value.theme || !value.options) return undefined;
	return value as MarkdownState;
}

const lexer = new Marked();

/** Split a Markdown block into text parts and wide-diagram parts; null = render normally. */
function buildParts(md: MarkdownState, width: number): Part[] | null {
	const text = md.text;
	if (!renderMermaid || !maxWidth || md.paddingY !== 0) return null;
	const padX: number = md.paddingX ?? 0;
	const pieces: { src: string; need: number }[] = [];
	let cursor = 0;
	// Top-level tokens only, like Pi: diagrams nested in lists, quotes or longer fences stay put.
	for (const token of lexer.lexer(text)) {
		if (!isMermaid(token)) continue;
		const art = artWidth(token.text);
		const need = art + padX * 2;
		// Use the real viewport budget, not an imaginary width equal to the art.
		// This preserves Pi's disabled/streaming/warning fallback behavior too.
		if (!art || need > width || !piWillDraw(md, token.raw, width - padX * 2)) continue;
		const at = text.indexOf(token.raw, cursor);
		if (at < 0) return null;
		pieces.push({ src: text.slice(cursor, at), need: 0 }, { src: token.raw, need });
		cursor = at + token.raw.length;
	}
	if (!pieces.length) return null;
	pieces.push({ src: text.slice(cursor), need: 0 });
	return pieces
		.map((piece) => ({ ...piece, src: piece.src.replace(/^\n+|\n+$/g, "") }))
		.filter((piece) => piece.src.trim())
		.map((piece) => ({
			md: new Markdown(piece.src, padX, 0, md.theme, md.defaultTextStyle, md.options),
			need: piece.need,
		}));
}

function renderSplit(md: Markdown & HookedComponent, width: number): string[] | null {
	const fields = markdownState(md);
	if (!fields) return null;
	const key = `${width}\0${maxWidth}\0${fields.text}`;
	if (md[PARTS]?.key !== key) md[PARTS] = { key, parts: buildParts(fields, width) };
	const parts: Part[] | null = md[PARTS].parts;
	if (!parts) return null;
	const lines: string[] = [];
	for (const part of parts) {
		const { w, pad } = column(width, part.need);
		if (lines.length && lines[lines.length - 1]!.trim()) lines.push("");
		lines.push(...indent(part.md.render(w), pad));
	}
	return lines;
}

// ---------- Impl ----------

/** Containers we descend into; everything else is narrowed as one block. */
function isWalked(comp: Component): comp is Container {
	return Object.getPrototypeOf(comp) === Container.prototype || comp instanceof AssistantMessageComponent;
}

const impl: Impl = {
	render(comp, width, render) {
		if (isWalked(comp)) {
			for (const child of comp.children ?? []) hook(child); // children change as messages arrive
			return render(width);
		}
		if (comp instanceof Markdown) {
			const lines = renderSplit(comp, width);
			if (lines) return lines;
		}
		const { w, pad } = column(width);
		return indent(render(w), pad);
	},
	handleMouse(comp, event, handleMouse) {
		if (isWalked(comp)) return handleMouse(event);
		const { w, pad } = column(event.width);
		if (event.x < pad || event.x >= pad + w) return undefined;
		return handleMouse({ ...event, x: event.x - pad, width: w });
	},
};

// ---------- Extension ----------

/** Register the local centered layout and the compatible /maxwidth command. */
export default function (pi: ExtensionAPI) {
	const envRaw = process.env.PI_CENTERED_WIDTH;
	const envWidth = envRaw === undefined ? undefined : parseWidth(envRaw.trim());
	maxWidth = envWidth ?? loadSaved() ?? DEFAULT_WIDTH;

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (envRaw !== undefined && envWidth === undefined) {
			ctx.ui.notify(`PI_CENTERED_WIDTH="${envRaw}" ignored: use 0 or a whole number >= ${MIN_WIDTH}`, "warning");
		}
		if (!(await loadMermaid())) {
			ctx.ui.notify("pi-centered: grok-mermaid not found; wide diagrams stay in the column", "warning");
		}
		// Borrow the TUI via a throwaway widget (its factory runs synchronously), then remove it.
		ctx.ui.setWidget("__pi-centered", (tui) => {
			state.tui = tui;
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget("__pi-centered", undefined);
		state.impl = impl;
		for (const child of state.tui?.children ?? []) hook(child);
		state.tui?.requestRender(true);
	});

	pi.on("session_shutdown", async () => {
		if (state.impl !== impl) return; // a newer load already took over
		state.impl = undefined;
		try {
			state.tui?.requestRender(true);
		} catch {}
	});

	pi.registerCommand("maxwidth", {
		description: `Set max content width: /maxwidth <n >= ${MIN_WIDTH}> | off (saved). No arg shows current.`,
		handler: async (arg, ctx) => {
			const value = (arg ?? "").trim();
			if (!value) {
				ctx.ui.notify(label(maxWidth), "info");
				return;
			}
			const width = parseWidth(value);
			if (width === undefined) {
				ctx.ui.notify(`Usage: /maxwidth <whole number >= ${MIN_WIDTH}> | off`, "error");
				return;
			}
			let saved = true;
			try {
				writeFileSync(CONFIG, JSON.stringify({ maxWidth: width }, null, 2) + "\n");
			} catch (error) {
				saved = false;
				ctx.ui.notify(`Could not save ${CONFIG}: ${(error as Error).message}`, "error");
			}
			maxWidth = width;
			state.tui?.requestRender(true);
			const note = !saved
				? " (this session only)"
				: envWidth !== undefined
					? ` (saved; PI_CENTERED_WIDTH=${envWidth} still wins on next launch)`
					: " (saved)";
			ctx.ui.notify(label(width) + note, "info");
		},
	});
}
