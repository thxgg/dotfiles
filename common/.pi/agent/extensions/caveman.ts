/**
 * Caveman Extension
 *
 * Ultra-compressed communication mode inspired by https://github.com/JuliusBrussee/caveman
 * Cuts ~75% output tokens while keeping full technical accuracy.
 *
 * Features:
 * - /caveman command to toggle or set level
 * - Ctrl+\ shortcut to cycle through levels
 * - Footer status indicator with colored level text
 * - State persistence across sessions
 *
 * Levels:
 *   off          — Normal mode
 *   lite         — Professional, no fluff. Keep articles + full sentences
 *   full         — Default caveman. Drop articles, fragments OK
 *   ultra        — Maximum compression. Abbreviate, arrows, telegraphic
 *   wenyan-lite  — Semi-classical Chinese register
 *   wenyan       — Full 文言文 classical terseness
 *   wenyan-ultra — Extreme classical compression
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type CavemanLevel = "off" | "lite" | "full" | "ultra" | "wenyan-lite" | "wenyan" | "wenyan-ultra";

const CYCLE_LEVELS: CavemanLevel[] = ["off", "lite", "full", "ultra"];

const ALL_LEVELS: CavemanLevel[] = ["off", "lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra"];

const LEVEL_LABEL: Record<CavemanLevel, string> = {
	off: "",
	lite: "lite",
	full: "full",
	ultra: "ultra",
	"wenyan-lite": "wenyan-lite",
	wenyan: "wenyan",
	"wenyan-ultra": "wenyan-ultra",
};

const CAVEMAN_PROMPT = `Respond terse like smart caveman. All technical substance stay. Only fluff die.

## Rules

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: [thing] [action] [reason]. [next step].

Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use '<' not '<='. Fix:"

## Intensity

| Level | What change |
|-------|------------|
| **lite** | No filler/hedging. Keep articles + full sentences. Professional but tight |
| **full** | Drop articles, fragments OK, short synonyms. Classic caveman |
| **ultra** | Abbreviate (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X -> Y), one word when one word enough |
| **wenyan-lite** | Semi-classical. Drop filler/hedging but keep grammar structure, classical register |
| **wenyan** | Maximum classical terseness. Fully 文言文. 80-90% character reduction. Classical sentence patterns, verbs precede objects, subjects often omitted, classical particles (之/乃/為/其) |
| **wenyan-ultra** | Extreme abbreviation while keeping classical Chinese feel. Maximum compression, ultra terse |

## Auto-Clarity

Drop caveman for: security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread, user confused. Resume caveman after clear part done.

## Boundaries

Code/commits/PRs: write normal. Level persist until changed or session end.`;

export default function cavemanExtension(pi: ExtensionAPI) {
	let level: CavemanLevel = "off";

	function updateStatus(ctx: ExtensionContext): void {
		if (level === "off") {
			ctx.ui.setStatus("caveman", undefined);
			return;
		}

		const label = LEVEL_LABEL[level];
		const theme = ctx.ui.theme;

		const color = level === "lite" || level === "wenyan-lite" ? "dim"
			: level === "ultra" || level === "wenyan-ultra" ? "warning"
			: "accent";

		ctx.ui.setStatus("caveman", theme.fg(color, label) + theme.fg("dim", " \u2022"));
	}

	function setLevel(newLevel: CavemanLevel, ctx: ExtensionContext): void {
		const prev = level;
		level = newLevel;

		if (level === "off") {
			ctx.ui.notify("Caveman off. Normal mode restored.", "info");
		} else if (prev === "off") {
			ctx.ui.notify(`Caveman mode: ${level}`, "info");
		} else {
			ctx.ui.notify(`Caveman: ${level}`, "info");
		}

		updateStatus(ctx);
		persistState();
	}

	function cycleLevel(ctx: ExtensionContext): void {
		const currentIndex = CYCLE_LEVELS.indexOf(level);
		const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % CYCLE_LEVELS.length;
		setLevel(CYCLE_LEVELS[nextIndex], ctx);
	}

	function persistState(): void {
		pi.appendEntry("caveman-state", { level });
	}

	// /caveman command
	pi.registerCommand("caveman", {
		description: "Toggle or set caveman compression level (lite/full/ultra/wenyan-lite/wenyan/wenyan-ultra/off)",
		getArgumentCompletions: (prefix: string) => {
			const items = ALL_LEVELS.map((l) => ({ value: l, label: l }));
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const arg = args?.trim().toLowerCase() as CavemanLevel | undefined;

			if (arg && ALL_LEVELS.includes(arg)) {
				setLevel(arg, ctx);
			} else if (arg) {
				ctx.ui.notify(`Unknown level "${arg}". Use: ${ALL_LEVELS.join(", ")}`, "warning");
			} else {
				cycleLevel(ctx);
			}
		},
	});

	// Ctrl+\ shortcut to cycle
	pi.registerShortcut("ctrl+\\", {
		description: "Cycle caveman level",
		handler: async (ctx) => {
			cycleLevel(ctx);
		},
	});

	// Inject caveman instructions into system prompt
	pi.on("before_agent_start", async (event) => {
		if (level === "off") return;

		return {
			systemPrompt:
				event.systemPrompt +
				`\n\n[CAVEMAN MODE: ${level.toUpperCase()}]\n\n` +
				CAVEMAN_PROMPT +
				`\n\nCurrent level: **${level}**. Apply the "${level}" intensity from the table above.`,
		};
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();

		const stateEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "caveman-state")
			.pop() as { data?: { level: CavemanLevel } } | undefined;

		if (stateEntry?.data?.level && ALL_LEVELS.includes(stateEntry.data.level)) {
			level = stateEntry.data.level;
		}

		updateStatus(ctx);
	});
}
