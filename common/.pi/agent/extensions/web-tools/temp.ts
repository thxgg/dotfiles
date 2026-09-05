import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOutputSettings, type OutputSettings } from "./output-settings.ts";

export const OUTPUT_CLEANUP_MAX_ENTRIES = 128;
const DAY_MS = 86_400_000;
const OWNED_FILE = /^pi-web(?:fetch|search)-([0-9]{1,16})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-output\.txt$/;

export interface OutputFileOptions extends Partial<OutputSettings> {
	readonly directory?: string;
	readonly now?: () => number;
	readonly env?: Readonly<Record<string, string | undefined>>;
}

export class OutputFiles {
	readonly settings: OutputSettings;
	readonly directory: string;
	private readonly now: () => number;

	constructor(options: OutputFileOptions = {}) {
		this.settings = getOutputSettings(options.env, options);
		this.directory = options.directory ?? join(tmpdir(), `pi-web-tools-output-${process.getuid?.() ?? "user"}`);
		this.now = options.now ?? Date.now;
	}

	async write(prefix: string, fileName: string, content: string): Promise<string> {
		if (!["pi-webfetch-", "pi-websearch-"].includes(prefix) || fileName !== "output.txt") {
			throw new Error("Invalid web-tools output name");
		}
		await mkdir(this.directory, { mode: 0o700 }).catch((cause: unknown) => {
			if (!isAlreadyExists(cause)) throw cause;
		});
		await this.checkDirectory();
		const now = this.now();
		if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid output clock");
		// Run before creating the current output. Cleanup cannot fail a successful write.
		await this.cleanup(now).catch(() => undefined);
		await this.checkDirectory();
		const path = join(this.directory, `${prefix}${now}-${randomUUID()}-${fileName}`);
		const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
		try {
			await file.writeFile(content, "utf8");
		} finally {
			await file.close();
		}
		return path;
	}

	/** Inspect at most 128 entries, without recursion or following symlinks. */
	async cleanup(now = this.now()): Promise<void> {
		try {
			await this.checkDirectory();
			const cutoff = now - this.settings.retentionDays * DAY_MS;
			if (!Number.isFinite(cutoff)) return;
			const directory = await opendir(this.directory, { bufferSize: 16 });
			let visited = 0;
			try {
				while (visited++ < OUTPUT_CLEANUP_MAX_ENTRIES) {
					const entry = await directory.read();
					if (!entry) break;
					const match = OWNED_FILE.exec(entry.name);
					if (!entry.isFile() || !match || Number(match[1]) >= cutoff) continue;
					try {
						await this.checkDirectory();
						const path = join(this.directory, entry.name);
						const stat = await lstat(path);
						if (stat.isFile() && stat.nlink === 1 && stat.mtimeMs < cutoff
							&& (process.getuid === undefined || stat.uid === process.getuid())) {
							await unlink(path);
						}
					} catch { /* Best-effort per entry. */ }
				}
			} finally {
				await directory.close();
			}
		} catch { /* Cleanup never prevents output preservation. */ }
	}

	private async checkDirectory(): Promise<void> {
		const stat = await lstat(this.directory);
		if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700
			|| (process.getuid !== undefined && stat.uid !== process.getuid())) {
			throw new Error("Web-tools output directory must be private and must not be a symlink");
		}
	}
}

export async function writeTempTextFile(
	prefix: string, fileName: string, content: string, options: OutputFileOptions = {},
): Promise<string> {
	return new OutputFiles(options).write(prefix, fileName, content);
}

function isAlreadyExists(cause: unknown): boolean {
	return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST";
}
