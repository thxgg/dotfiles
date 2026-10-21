// Derived from badlogic/pi-subagent at 4fc1fe5. See UPSTREAM.md.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
	existsSync,
	mkdirSync,
	openSync,
	closeSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type RunState = "starting" | "busy" | "idle" | "exited" | "error";

export interface RunMetadata {
	version: 1;
	handle: string;
	name?: string;
	parentSessionId?: string;
	parentSessionFile?: string;
	childSessionId?: string;
	parentPid?: number;
	pid?: number;
	kind?: "standalone" | "workflow";
	prompt?: string;
	completedAt?: string;
	aborted?: boolean;
	runDir: string;
	sessionFile: string;
	cwd: string;
	provider: string;
	model: string;
	thinking: string;
	/** Extra pi CLI flags (tools, isolation) reused when the run is relaunched. */
	launchArgs?: string[];
	/** Set by the parent when it stops the child on quit or session switch; the child is relaunched on resume. */
	suspended?: boolean;
	state: RunState;
	hasStarted: boolean;
	createdAt: string;
	updatedAt: string;
	error?: string;
}

export interface InboxMessage {
	message: string;
	delivery: "auto" | "followUp";
}

interface SessionEntry {
	type: string;
	id: string;
	parentId: string | null;
	message?: unknown;
}

export interface AssistantMessage {
	role: "assistant";
	content?: unknown;
	stopReason?: string;
	errorMessage?: string;
}

interface AssistantEntry extends SessionEntry {
	type: "message";
	message: AssistantMessage;
}

export function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function getRunsDir(): string {
	return join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "pi", "subagents-v2");
}

export function metadataPath(runDir: string): string {
	return join(runDir, "metadata.json");
}

export function inboxDir(runDir: string): string {
	return join(runDir, "inbox");
}

export function isValidRunName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 64 &&
		value.trim() === value &&
		!/[\u0000-\u001f\u007f]/.test(value)
	);
}

export function runDisplayName(metadata: RunMetadata): string {
	return metadata.name ? `${metadata.name} (${metadata.handle})` : metadata.handle;
}

export function readMetadata(runDir: string): RunMetadata | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(metadataPath(runDir), "utf8"));
		if (typeof value !== "object" || value === null) return undefined;
		const metadata = value as Partial<RunMetadata>;
		if (
			metadata.version !== 1 ||
			typeof metadata.handle !== "string" ||
			(metadata.name !== undefined && !isValidRunName(metadata.name)) ||
			typeof metadata.cwd !== "string" ||
			typeof metadata.provider !== "string" ||
			typeof metadata.model !== "string" ||
			!["starting", "busy", "idle", "exited", "error"].includes(String(metadata.state)) ||
			typeof metadata.sessionFile !== "string" ||
			typeof metadata.runDir !== "string"
		) {
			return undefined;
		}
		return metadata as RunMetadata;
	} catch {
		return undefined;
	}
}

export function writeMetadata(metadata: RunMetadata): void {
	mkdirSync(dirname(metadataPath(metadata.runDir)), { recursive: true, mode: 0o700 });
	const target = metadataPath(metadata.runDir);
	const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, target);
}

export function updateMetadata(runDir: string, patch: Partial<RunMetadata>): RunMetadata | undefined {
	const current = readMetadata(runDir);
	if (!current) return undefined;
	const next: RunMetadata = {
		...current,
		...patch,
		version: 1,
		handle: current.handle,
		runDir: current.runDir,
		updatedAt: new Date().toISOString(),
	};
	writeMetadata(next);
	return next;
}

export async function waitForRunShutdown(runDir: string, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const metadata = readMetadata(runDir);
		if (!metadata || metadata.state === "exited") return;
		await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
	}
}

export function enqueue(runDir: string, payload: InboxMessage | { control: "stop" | "suspend" }): void {
	const queue = inboxDir(runDir);
	mkdirSync(queue, { recursive: true, mode: 0o700 });
	const target = join(queue, `${Date.now()}-${randomBytes(4).toString("hex")}.json`);
	writeFileSync(`${target}.tmp`, JSON.stringify(payload), { mode: 0o600 });
	renameSync(`${target}.tmp`, target);
}

export async function stopRun(run: RunMetadata, suspended = false): Promise<void> {
	// Startup has a short window before the supervisor publishes its PID.
	const deadline = Date.now() + 15_000;
	while (run.state === "starting" && !run.pid && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		run = readMetadata(run.runDir) ?? run;
	}
	if (run.state === "starting" && !run.pid) throw new Error(`Subagent ${run.handle} startup is unresolved; retained its state.`);
	if (processExists(run.pid)) {
		enqueue(run.runDir, { control: suspended ? "suspend" : "stop" });
		await waitForRunShutdown(run.runDir, 5000);
		const current = readMetadata(run.runDir);
		if (current?.pid && processExists(current.pid)) throw new Error(`Subagent ${run.handle} did not stop; retained its state.`);
	}
	updateMetadata(run.runDir, { state: "exited", suspended, pid: undefined });
}

export function removeRunDir(runDir: string): void {
	rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export function processExists(pid: number | undefined): boolean {
	if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; } catch { return false; }
}

/** A detached supervisor owns RPC pipes. Reloading the parent cannot close them. */
export async function launchRun(metadata: RunMetadata): Promise<void> {
	const current = readMetadata(metadata.runDir);
	if (current?.pid && processExists(current.pid)) throw new Error(`Subagent ${metadata.handle} is already running.`);
	updateMetadata(metadata.runDir, { state: "starting", pid: undefined, error: undefined });
	const log = openSync(join(metadata.runDir, "supervisor.log"), "a", 0o600);
	try {
		const child = spawn("node", [fileURLToPath(new URL("./supervisor.ts", import.meta.url)), metadata.runDir], {
			cwd: metadata.cwd, detached: true, stdio: ["ignore", log, log],
			env: { ...process.env, PI_SUBAGENT_RUN_DIR: metadata.runDir },
		});
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("spawn", () => { child.unref(); resolve(); });
		});
	} finally { closeSync(log); }
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const run = readMetadata(metadata.runDir);
		if (run?.state === "error") throw new Error(run.error ?? "Subagent startup failed.");
		if (run?.pid && run.state !== "starting") return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Subagent ${metadata.handle} did not become ready. Inspect ${join(metadata.runDir, "supervisor.log")}`);
}

export function effectiveRunState(metadata: RunMetadata): RunState {
	if (
		(metadata.state === "starting" || metadata.state === "busy" || metadata.state === "idle") &&
		metadata.pid !== undefined && !processExists(metadata.pid)
	) {
		return "exited";
	}
	return metadata.state;
}

export function listRuns(parentSessionId?: string): RunMetadata[] {
	const root = getRunsDir();
	if (!existsSync(root)) return [];
	const runs: RunMetadata[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const metadata = readMetadata(join(root, entry.name));
		if (!metadata) continue;
		if (parentSessionId && metadata.parentSessionId !== parentSessionId) continue;
		runs.push(metadata);
	}
	return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function isSessionEntry(value: unknown): value is SessionEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.type === "string" &&
		typeof entry.id === "string" &&
		(entry.parentId === null || typeof entry.parentId === "string")
	);
}

function activeBranch(entries: SessionEntry[]): SessionEntry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const branch: SessionEntry[] = [];
	const seen = new Set<string>();
	let current = entries.at(-1);
	while (current && !seen.has(current.id)) {
		branch.push(current);
		seen.add(current.id);
		current = current.parentId === null ? undefined : byId.get(current.parentId);
	}
	return branch.reverse();
}

function isAssistantEntry(entry: SessionEntry): entry is AssistantEntry {
	if (entry.type !== "message" || typeof entry.message !== "object" || entry.message === null) return false;
	return (entry.message as Record<string, unknown>).role === "assistant";
}

export function readLatestAssistant(sessionFile: string): AssistantMessage | undefined {
	let content: string;
	try {
		content = readFileSync(sessionFile, "utf8");
	} catch {
		return undefined;
	}
	const entries: SessionEntry[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			const value: unknown = JSON.parse(line);
			if (isSessionEntry(value)) entries.push(value);
		} catch {
			// The final JSONL record may still be in the process of being appended.
		}
	}
	return activeBranch(entries).findLast(isAssistantEntry)?.message;
}

export function assistantText(message: AssistantMessage): string {
	if (!Array.isArray(message.content)) return message.errorMessage ?? "(no response text)";
	const parts: string[] = [];
	for (const item of message.content) {
		if (typeof item !== "object" || item === null) continue;
		const block = item as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n").trim() || message.errorMessage || "(no response text)";
}
