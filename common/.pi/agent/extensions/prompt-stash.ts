import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

const CUSTOM_TYPE = "prompt-stash";

const CONFIG = {
	shortcut: Key.ctrl("s"),
	maxStashesPerBranch: 50,
	dedupe: true,
};

type StashAction = "push" | "pop" | "drop" | "clear" | "apply" | "restore-pending" | "restore-complete";
type StashScope = "branch" | "global";
type RestoreMode = "replace" | "append" | "insert";

type PromptStash = {
	id: string;
	text: string;
	branchId: string;
	sessionId?: string;
	label?: string;
	createdAt: number;
	updatedAt?: number;
};

type StashState = {
	byBranch: Map<string, PromptStash[]>;
	pendingAutoRestore?: {
		stashId: string;
		branchId: string;
	};
};

type PromptStashEntry = {
	type: typeof CUSTOM_TYPE;
	action: StashAction;
	id: string;
	branchId: string;
	sessionId?: string;
	text?: string;
	label?: string;
	createdAt: string;
	updatedAt?: string;
	scope?: StashScope;
	status?: "restored" | "skipped";
	reason?: string;
};

type ParsedStashEntry = PromptStashEntry & {
	entryCreatedAt: number;
	entryUpdatedAt?: number;
};

type BranchReplay = {
	stashes: PromptStash[];
	pendingAutoRestore?: StashState["pendingAutoRestore"];
};

type AllStashRecord = PromptStash & {
	activeLeafIds: string[];
	activeOnCurrentBranch: boolean;
};

const ACTIONS = new Set<StashAction>([
	"push",
	"pop",
	"drop",
	"clear",
	"apply",
	"restore-pending",
	"restore-complete",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function nowIso(): string {
	return new Date().toISOString();
}

function parseTime(value: unknown, fallback?: number): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback ?? Date.now();
}

function currentBranchId(ctx: ExtensionContext): string {
	return ctx.sessionManager.getLeafId() ?? `session:${ctx.sessionManager.getSessionId()}`;
}

function shortId(id: string | undefined): string {
	if (!id) return "unknown";
	return id.length <= 10 ? id : id.slice(0, 8);
}

function isBlank(text: string): boolean {
	return text.trim().length === 0;
}

function getEditorText(ctx: ExtensionContext): string {
	try {
		return ctx.ui.getEditorText() ?? "";
	} catch {
		return "";
	}
}

function setEditorText(ctx: ExtensionContext, text: string): void {
	ctx.ui.setEditorText(text);
}

function previewText(text: string, max = 72): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return "(empty)";
	return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1))}…` : normalized;
}

function formatTimestamp(timestamp: number): string {
	try {
		return new Date(timestamp).toLocaleString(undefined, {
			month: "short",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return String(timestamp);
	}
}

function getParsedStashEntry(entry: SessionEntry): ParsedStashEntry | null {
	if (entry.type !== "custom") return null;
	if (entry.customType !== CUSTOM_TYPE) return null;
	if (!isRecord(entry.data)) return null;

	const data = entry.data;
	const action = data.action;
	const id = data.id;
	const branchId = data.branchId;

	if (typeof action !== "string" || !ACTIONS.has(action as StashAction)) return null;
	if (typeof id !== "string" || !id) return null;
	if (typeof branchId !== "string" || !branchId) return null;
	if (typeof data.type === "string" && data.type !== CUSTOM_TYPE) return null;

	const createdAt = typeof data.createdAt === "string" ? data.createdAt : entry.timestamp;
	const updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : undefined;
	const scope = data.scope === "global" ? "global" : data.scope === "branch" ? "branch" : undefined;
	const status = data.status === "restored" || data.status === "skipped" ? data.status : undefined;
	const reason = typeof data.reason === "string" ? data.reason : undefined;

	return {
		type: CUSTOM_TYPE,
		action: action as StashAction,
		id,
		branchId,
		sessionId: typeof data.sessionId === "string" ? data.sessionId : undefined,
		text: typeof data.text === "string" ? data.text : undefined,
		label: typeof data.label === "string" ? data.label : undefined,
		createdAt,
		updatedAt,
		scope,
		status,
		reason,
		entryCreatedAt: parseTime(createdAt, parseTime(entry.timestamp)),
		entryUpdatedAt: updatedAt ? parseTime(updatedAt) : undefined,
	};
}

function collectGlobalTombstones(entries: SessionEntry[]): Set<string> {
	const tombstones = new Set<string>();

	for (const entry of entries) {
		const data = getParsedStashEntry(entry);
		if (!data || data.scope !== "global") continue;
		if (data.action === "drop" || data.action === "pop") {
			tombstones.add(data.id);
		}
	}

	return tombstones;
}

function replayStashes(entries: SessionEntry[], globalTombstones = new Set<string>()): BranchReplay {
	let stashes: PromptStash[] = [];
	let pendingAutoRestore: BranchReplay["pendingAutoRestore"];

	const removeStash = (id: string) => {
		stashes = stashes.filter((stash) => stash.id !== id);
		if (pendingAutoRestore?.stashId === id) {
			pendingAutoRestore = undefined;
		}
	};

	for (const entry of entries) {
		const data = getParsedStashEntry(entry);
		if (!data) continue;

		switch (data.action) {
			case "push": {
				if (typeof data.text !== "string" || isBlank(data.text)) break;

				if (CONFIG.dedupe) {
					stashes = stashes.filter((stash) => stash.text !== data.text && stash.id !== data.id);
				} else {
					stashes = stashes.filter((stash) => stash.id !== data.id);
				}

				stashes.unshift({
					id: data.id,
					text: data.text,
					branchId: data.branchId,
					sessionId: data.sessionId,
					label: data.label,
					createdAt: data.entryCreatedAt,
					updatedAt: data.entryUpdatedAt,
				});

				if (stashes.length > CONFIG.maxStashesPerBranch) {
					stashes = stashes.slice(0, CONFIG.maxStashesPerBranch);
				}
				break;
			}
			case "pop":
			case "drop":
				removeStash(data.id);
				break;
			case "clear":
				stashes = [];
				pendingAutoRestore = undefined;
				break;
			case "restore-pending":
				pendingAutoRestore = { stashId: data.id, branchId: data.branchId };
				break;
			case "restore-complete":
				if (!pendingAutoRestore || pendingAutoRestore.stashId === data.id) {
					pendingAutoRestore = undefined;
				}
				break;
			case "apply":
				break;
		}
	}

	if (globalTombstones.size > 0) {
		stashes = stashes.filter((stash) => !globalTombstones.has(stash.id));
		if (pendingAutoRestore && globalTombstones.has(pendingAutoRestore.stashId)) {
			pendingAutoRestore = undefined;
		}
	}

	if (pendingAutoRestore && !stashes.some((stash) => stash.id === pendingAutoRestore?.stashId)) {
		pendingAutoRestore = undefined;
	}

	return { stashes, pendingAutoRestore };
}

function getCurrentReplay(ctx: ExtensionContext): BranchReplay {
	const globalTombstones = collectGlobalTombstones(ctx.sessionManager.getEntries());
	return replayStashes(ctx.sessionManager.getBranch(), globalTombstones);
}

function getCurrentStashState(ctx: ExtensionContext): StashState {
	const replay = getCurrentReplay(ctx);
	return {
		byBranch: new Map([[currentBranchId(ctx), replay.stashes]]),
		pendingAutoRestore: replay.pendingAutoRestore,
	};
}

function getCurrentStashes(ctx: ExtensionContext): PromptStash[] {
	const state = getCurrentStashState(ctx);
	return state.byBranch.get(currentBranchId(ctx)) ?? [];
}

function getLeafIds(ctx: ExtensionContext): string[] {
	const entries = ctx.sessionManager.getEntries();
	const parents = new Set<string>();
	for (const entry of entries) {
		if (entry.parentId) parents.add(entry.parentId);
	}

	const leaves = entries.filter((entry) => !parents.has(entry.id)).map((entry) => entry.id);
	const currentLeaf = ctx.sessionManager.getLeafId();
	if (currentLeaf && !leaves.includes(currentLeaf)) leaves.push(currentLeaf);
	return leaves;
}

function getAllActiveStashes(ctx: ExtensionContext): AllStashRecord[] {
	const globalTombstones = collectGlobalTombstones(ctx.sessionManager.getEntries());
	const currentIds = new Set(getCurrentReplay(ctx).stashes.map((stash) => stash.id));
	const byId = new Map<string, AllStashRecord>();

	for (const leafId of getLeafIds(ctx)) {
		const replay = replayStashes(ctx.sessionManager.getBranch(leafId), globalTombstones);
		for (const stash of replay.stashes) {
			const existing = byId.get(stash.id);
			if (existing) {
				if (!existing.activeLeafIds.includes(leafId)) existing.activeLeafIds.push(leafId);
				existing.activeOnCurrentBranch = existing.activeOnCurrentBranch || currentIds.has(stash.id);
				continue;
			}

			byId.set(stash.id, {
				...stash,
				activeLeafIds: [leafId],
				activeOnCurrentBranch: currentIds.has(stash.id),
			});
		}
	}

	return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function appendStashEntry(pi: ExtensionAPI, ctx: ExtensionContext, data: Omit<PromptStashEntry, "type" | "createdAt"> & { createdAt?: string }): void {
	pi.appendEntry<PromptStashEntry>(CUSTOM_TYPE, {
		type: CUSTOM_TYPE,
		createdAt: data.createdAt ?? nowIso(),
		...data,
	});
}

function appendRestoreComplete(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	stash: PromptStash,
	status: "restored" | "skipped",
	reason?: string,
): void {
	appendStashEntry(pi, ctx, {
		action: "restore-complete",
		id: stash.id,
		branchId: stash.branchId,
		sessionId: stash.sessionId ?? ctx.sessionManager.getSessionId(),
		updatedAt: nowIso(),
		status,
		reason,
	});
}

function appendPopOrDrop(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	stash: PromptStash,
	action: "pop" | "drop",
	scope: StashScope,
): void {
	appendStashEntry(pi, ctx, {
		action,
		id: stash.id,
		branchId: stash.branchId,
		sessionId: stash.sessionId ?? ctx.sessionManager.getSessionId(),
		updatedAt: nowIso(),
		scope,
	});
}

function appendApply(pi: ExtensionAPI, ctx: ExtensionContext, stash: PromptStash, scope: StashScope): void {
	appendStashEntry(pi, ctx, {
		action: "apply",
		id: stash.id,
		branchId: stash.branchId,
		sessionId: stash.sessionId ?? ctx.sessionManager.getSessionId(),
		updatedAt: nowIso(),
		scope,
	});
}

function appendClear(pi: ExtensionAPI, ctx: ExtensionContext): void {
	appendStashEntry(pi, ctx, {
		action: "clear",
		id: randomUUID(),
		branchId: currentBranchId(ctx),
		sessionId: ctx.sessionManager.getSessionId(),
		updatedAt: nowIso(),
		scope: "branch",
	});
}

async function pushText(pi: ExtensionAPI, ctx: ExtensionContext, text: string, label?: string): Promise<void> {
	if (isBlank(text)) {
		ctx.ui.notify("Nothing to stash", "info");
		return;
	}

	const id = randomUUID();
	const branchId = currentBranchId(ctx);
	const sessionId = ctx.sessionManager.getSessionId();
	const createdAt = nowIso();

	appendStashEntry(pi, ctx, {
		action: "push",
		id,
		branchId,
		sessionId,
		text,
		label,
		createdAt,
		scope: "branch",
	});
	appendStashEntry(pi, ctx, {
		action: "restore-pending",
		id,
		branchId,
		sessionId,
		createdAt: nowIso(),
		scope: "branch",
	});

	setEditorText(ctx, "");
	ctx.ui.notify("Stashed — will restore after next turn", "info");
}

function applyRestoreMode(ctx: ExtensionContext, text: string, mode: RestoreMode): void {
	if (mode === "replace") {
		setEditorText(ctx, text);
		return;
	}

	if (mode === "append") {
		const current = getEditorText(ctx);
		const separator = current.length === 0 || current.endsWith("\n") || text.startsWith("\n") ? "" : "\n";
		setEditorText(ctx, `${current}${separator}${text}`);
		return;
	}

	ctx.ui.pasteToEditor(text);
}

async function chooseRestoreMode(ctx: ExtensionContext): Promise<RestoreMode | null> {
	const current = getEditorText(ctx);
	if (isBlank(current)) return "replace";

	if (!ctx.hasUI) {
		ctx.ui.notify("Editor has text; stash kept", "warning");
		return null;
	}

	const choice = await ctx.ui.select("Editor already has text. Restore stash how?", [
		"Replace editor",
		"Append to editor",
		"Paste at cursor / insert",
		"Cancel",
	]);

	if (choice === "Replace editor") return "replace";
	if (choice === "Append to editor") return "append";
	if (choice === "Paste at cursor / insert") return "insert";
	return null;
}

async function restoreStash(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	stash: PromptStash,
	semantics: "apply" | "pop",
	options: { scope?: StashScope; notify?: boolean } = {},
): Promise<boolean> {
	const mode = await chooseRestoreMode(ctx);
	if (!mode) return false;

	const pending = getCurrentReplay(ctx).pendingAutoRestore;
	const wasPending = pending?.stashId === stash.id;
	const scope = options.scope ?? "branch";

	applyRestoreMode(ctx, stash.text, mode);

	if (semantics === "pop") {
		appendPopOrDrop(pi, ctx, stash, "pop", scope);
	} else {
		appendApply(pi, ctx, stash, scope);
	}

	if (wasPending) {
		appendRestoreComplete(pi, ctx, stash, "restored");
	}

	if (options.notify !== false) {
		ctx.ui.notify(semantics === "pop" ? "Restored stash" : "Applied stash", "info");
	}
	return true;
}

async function offerAllStashes(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("No stashes on current branch", "info");
		return;
	}

	const choice = await ctx.ui.select("No stashes on current branch", ["View all stashes", "Cancel"]);
	if (choice === "View all stashes") {
		await showStashPicker(pi, ctx, "all");
	}
}

async function restoreLatest(pi: ExtensionAPI, ctx: ExtensionContext, semantics: "apply" | "pop"): Promise<void> {
	const stash = getCurrentStashes(ctx)[0];
	if (!stash) {
		await offerAllStashes(pi, ctx);
		return;
	}

	await restoreStash(pi, ctx, stash, semantics);
}

async function toggleStash(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const text = getEditorText(ctx);
	if (!isBlank(text)) {
		await pushText(pi, ctx, text);
		return;
	}

	await restoreLatest(pi, ctx, "pop");
}

function buildBranchPickerOptions(stashes: PromptStash[]): { options: string[]; byLabel: Map<string, PromptStash> } {
	const byLabel = new Map<string, PromptStash>();
	const options = stashes.map((stash, index) => {
		const label = `${index + 1}. ${previewText(stash.text)} — ${formatTimestamp(stash.createdAt)}`;
		byLabel.set(label, stash);
		return label;
	});

	return { options, byLabel };
}

function buildAllPickerOptions(records: AllStashRecord[], ctx: ExtensionContext): { options: string[]; byLabel: Map<string, AllStashRecord> } {
	const byLabel = new Map<string, AllStashRecord>();
	const sessionId = ctx.sessionManager.getSessionId();
	const options = records.map((stash, index) => {
		const branchInfo = stash.activeOnCurrentBranch
			? "current"
			: `branch:${shortId(stash.branchId)}`;
		const activeInfo = stash.activeLeafIds.length > 1 ? `, ${stash.activeLeafIds.length} branches` : "";
		const sessionInfo = `s:${shortId(stash.sessionId ?? sessionId)}`;
		const label = `${index + 1}. ${previewText(stash.text)} — ${formatTimestamp(stash.createdAt)} [${branchInfo}${activeInfo}, ${sessionInfo}]`;
		byLabel.set(label, stash);
		return label;
	});

	return { options, byLabel };
}

async function clearBranchStashes(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const stashes = getCurrentStashes(ctx);
	if (stashes.length === 0) {
		ctx.ui.notify("No stashes on current branch", "info");
		return;
	}

	const ok = await ctx.ui.confirm("Clear branch stashes?", `Delete ${stashes.length} stash${stashes.length === 1 ? "" : "es"} from the current branch?`);
	if (!ok) return;

	appendClear(pi, ctx);
	ctx.ui.notify("Cleared branch stashes", "info");
}

async function confirmCrossBranchApply(ctx: ExtensionContext): Promise<boolean> {
	if (!ctx.hasUI) return true;
	const choice = await ctx.ui.select("Stash is from another branch", ["Apply to current editor only", "Cancel"]);
	return choice === "Apply to current editor only";
}

async function handleBranchStashAction(pi: ExtensionAPI, ctx: ExtensionContext, stash: PromptStash): Promise<"back" | "done"> {
	const choice = await ctx.ui.select(`Stash: ${previewText(stash.text, 90)}`, [
		"Apply (keep stash)",
		"Pop (restore and remove)",
		"Drop",
		"Back",
		"Cancel",
	]);

	if (choice === "Apply (keep stash)") {
		await restoreStash(pi, ctx, stash, "apply");
		return "done";
	}
	if (choice === "Pop (restore and remove)") {
		await restoreStash(pi, ctx, stash, "pop");
		return "done";
	}
	if (choice === "Drop") {
		appendPopOrDrop(pi, ctx, stash, "drop", "branch");
		ctx.ui.notify("Dropped stash", "info");
		return "done";
	}
	if (choice === "Back") return "back";
	return "done";
}

async function handleAllStashAction(pi: ExtensionAPI, ctx: ExtensionContext, stash: AllStashRecord): Promise<"back" | "done"> {
	const actions = stash.activeOnCurrentBranch
		? ["Apply (keep stash)", "Pop (restore and remove)", "Drop", "Back", "Cancel"]
		: ["Apply to current editor only", "Pop into current editor (remove globally)", "Drop globally", "Back", "Cancel"];

	const choice = await ctx.ui.select(`Stash: ${previewText(stash.text, 90)}`, actions);

	if (choice === "Apply (keep stash)") {
		await restoreStash(pi, ctx, stash, "apply");
		return "done";
	}
	if (choice === "Pop (restore and remove)") {
		await restoreStash(pi, ctx, stash, "pop");
		return "done";
	}
	if (choice === "Drop") {
		appendPopOrDrop(pi, ctx, stash, "drop", "branch");
		ctx.ui.notify("Dropped stash", "info");
		return "done";
	}
	if (choice === "Apply to current editor only") {
		if (await confirmCrossBranchApply(ctx)) {
			await restoreStash(pi, ctx, stash, "apply", { scope: "global" });
			return "done";
		}
		return "back";
	}
	if (choice === "Pop into current editor (remove globally)") {
		if (await confirmCrossBranchApply(ctx)) {
			await restoreStash(pi, ctx, stash, "pop", { scope: "global" });
			return "done";
		}
		return "back";
	}
	if (choice === "Drop globally") {
		appendPopOrDrop(pi, ctx, stash, "drop", "global");
		ctx.ui.notify("Dropped stash globally", "info");
		return "done";
	}
	if (choice === "Back") return "back";
	return "done";
}

type PickerView = "branch" | "all" | "done";

async function showBranchPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<PickerView> {
	const stashes = getCurrentStashes(ctx);
	const { options, byLabel } = buildBranchPickerOptions(stashes);
	const pickerOptions = [
		...options,
		"View all stashes",
		...(stashes.length > 0 ? ["Clear branch stashes"] : []),
		"Cancel",
	];

	const choice = await ctx.ui.select("Prompt stashes (current branch)", pickerOptions);
	if (!choice || choice === "Cancel") return "done";
	if (choice === "View all stashes") return "all";
	if (choice === "Clear branch stashes") {
		await clearBranchStashes(pi, ctx);
		return "done";
	}

	const stash = byLabel.get(choice);
	if (!stash) return "done";

	return (await handleBranchStashAction(pi, ctx, stash)) === "back" ? "branch" : "done";
}

async function showAllPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<PickerView> {
	const stashes = getAllActiveStashes(ctx);
	const { options, byLabel } = buildAllPickerOptions(stashes, ctx);
	const pickerOptions = [...options, "Back to current branch stashes", "Cancel"];

	const choice = await ctx.ui.select("Prompt stashes (all branches)", pickerOptions);
	if (!choice || choice === "Cancel") return "done";
	if (choice === "Back to current branch stashes") return "branch";

	const stash = byLabel.get(choice);
	if (!stash) return "done";

	return (await handleAllStashAction(pi, ctx, stash)) === "back" ? "all" : "done";
}

async function showStashPicker(pi: ExtensionAPI, ctx: ExtensionContext, initialView: "branch" | "all" = "branch"): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Stash picker requires interactive UI", "warning");
		return;
	}

	let view: "branch" | "all" = initialView;
	while (true) {
		const next = view === "branch" ? await showBranchPicker(pi, ctx) : await showAllPicker(pi, ctx);
		if (next === "branch" || next === "all") {
			view = next;
			continue;
		}
		return;
	}
}

function commandDraftText(commandName: string, args: string, ctx: ExtensionCommandContext): string {
	const editorText = getEditorText(ctx);
	const trimmedEditor = editorText.trim();
	const trimmedArgs = args.trim();
	const commandPrefix = `/${commandName}`;

	if (trimmedEditor && trimmedEditor !== commandPrefix && !trimmedEditor.startsWith(`${commandPrefix} `)) {
		return editorText;
	}

	return trimmedArgs;
}

async function autoRestorePending(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const replay = getCurrentReplay(ctx);
	const pending = replay.pendingAutoRestore;
	if (!pending) return;

	const stash = replay.stashes.find((item) => item.id === pending.stashId);
	if (!stash) return;

	if (!isBlank(getEditorText(ctx))) {
		appendRestoreComplete(pi, ctx, stash, "skipped", "editor-not-empty");
		ctx.ui.notify("Stash kept; editor not empty", "warning");
		return;
	}

	setEditorText(ctx, stash.text);
	appendPopOrDrop(pi, ctx, stash, "pop", "branch");
	appendRestoreComplete(pi, ctx, stash, "restored");
	ctx.ui.notify("Restored stash", "info");
}

export default function promptStashExtension(pi: ExtensionAPI) {
	pi.registerShortcut(CONFIG.shortcut, {
		description: "Stash or restore prompt draft",
		handler: async (ctx) => {
			await toggleStash(pi, ctx);
		},
	});

	pi.registerCommand("stash", {
		description: "Stash current prompt draft or open the branch stash picker",
		handler: async (args, ctx) => {
			const text = commandDraftText("stash", args, ctx);
			if (!isBlank(text)) {
				await pushText(pi, ctx, text);
				return;
			}

			await showStashPicker(pi, ctx, "branch");
		},
	});

	pi.registerCommand("stash-list", {
		description: "Show prompt stashes for the current branch",
		handler: async (_args, ctx) => {
			await showStashPicker(pi, ctx, "branch");
		},
	});

	pi.registerCommand("stash-pop", {
		description: "Restore and remove the latest current-branch prompt stash",
		handler: async (_args, ctx) => {
			await restoreLatest(pi, ctx, "pop");
		},
	});

	pi.registerCommand("stash-apply", {
		description: "Restore the latest current-branch prompt stash without removing it",
		handler: async (_args, ctx) => {
			await restoreLatest(pi, ctx, "apply");
		},
	});

	pi.registerCommand("stash-clear", {
		description: "Clear prompt stashes on the current branch",
		handler: async (_args, ctx) => {
			await clearBranchStashes(pi, ctx);
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		await autoRestorePending(pi, ctx);
	});
}
