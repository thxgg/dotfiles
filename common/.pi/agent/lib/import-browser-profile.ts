import { constants } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/** Inputs for the Linux Helium importer; explicit roots also support isolated tests. */
export interface ImportOptions {
	readonly home: string;
	readonly configHome: string;
	readonly platform: string;
	readonly procRoot: string;
	readonly executable: string;
	/** Reports coarse stages only; never includes profile contents or credentials. */
	readonly onProgress?: (stage: string) => void;
}

/** A safe user-facing result. Cookie values never leave the copied files. */
export type ImportResult = { readonly ok: true; readonly profile: string } | { readonly ok: false; readonly message: string };

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCode(error: unknown, code: string): boolean {
	return record(error) && error.code === code;
}

async function exists(path: string): Promise<boolean> {
	try { await lstat(path); return true; }
	catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
}

async function readObject(path: string): Promise<Record<string, unknown>> {
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!record(value)) throw new Error("Expected a JSON object");
	return value;
}

async function browserOpen(procRoot: string, managedRoot: string): Promise<boolean> {
	for (const pid of await readdir(procRoot)) {
		if (!/^\d+$/.test(pid)) continue;
		try {
			if ((await lstat(join(procRoot, pid))).uid !== process.getuid?.()) continue;
			const command = (await readFile(join(procRoot, pid, "cmdline"), "utf8")).split("\0").filter(Boolean);
			if (command.length === 0) continue;
			// Linux protects exe links for non-dumpable processes, including systemd.
			// comm and argv identify Helium without requiring ptrace access.
			const name = (await readFile(join(procRoot, pid, "comm"), "utf8")).trim();
			if ([name, basename(command[0] ?? "")].some((value) => /^helium(?:$|[-_])/i.test(value))) return true;
			if (command.some((arg, index) => {
				const path = arg.startsWith("--user-data-dir=") ? arg.slice(16) : command[index - 1] === "--user-data-dir" ? arg : undefined;
				return path !== undefined && (resolve(path) === managedRoot || resolve(path).startsWith(`${managedRoot}/`));
			})) return true;
		} catch (error) {
			// Processes can exit during enumeration. Fail closed if our own processes cannot be read.
			if (hasCode(error, "ENOENT") || hasCode(error, "ESRCH")) continue;
			throw error;
		}
	}
	return false;
}

const excluded = new Set([
	"Cache", "Code Cache", "GPUCache", "ShaderCache", "GrShaderCache", "DawnGraphiteCache",
	"DawnWebGPUCache", "Crash Reports", "BrowserMetrics", "LOCK", "lockfile", "DevToolsActivePort",
	// Saved passwords, browsing history and extensions are not required for session reuse.
	"Login Data", "Login Data-journal", "Login Data For Account", "Login Data For Account-journal",
	"History", "History-journal", "Favicons", "Favicons-journal", "Extensions", "Extension State",
]);

async function copyPrivate(source: string, destination: string): Promise<void> {
	const stat = await lstat(source);
	if (stat.isSymbolicLink()) throw new Error("Profile contains an unexpected symbolic link");
	if (stat.isDirectory()) {
		await mkdir(destination, { mode: 0o700 });
		for (const entry of await readdir(source)) {
			if (!excluded.has(entry) && !entry.startsWith("Singleton")) {
				await copyPrivate(join(source, entry), join(destination, entry));
			}
		}
	} else if (stat.isFile()) {
		await copyFile(source, destination, constants.COPYFILE_EXCL);
		await chmod(destination, 0o600);
	} else {
		throw new Error("Profile contains an unexpected special file");
	}
}

/** Copy a closed Helium profile and atomically select it for new Agent Browser sessions. */
export async function importBrowserProfile(options: ImportOptions): Promise<ImportResult> {
	if (options.platform !== "linux") return { ok: false, message: "Browser profile import currently supports Linux only." };
	const agentRoot = join(options.home, ".agent-browser");
	const managedRoot = join(agentRoot, "helium-imports");
	const lock = join(managedRoot, ".import-lock");
	const configPath = join(agentRoot, "config.json");
	let locked = false;
	let staging: string | undefined;
	let configTemp: string | undefined;
	let committed = false;
	let stage = "checking running processes";
	function setStage(next: string): void {
		stage = next;
		options.onProgress?.(stage);
	}
	try {
		setStage(stage);
		if (await browserOpen(options.procRoot, managedRoot)) {
			return { ok: false, message: "Close all Helium instances, including Agent Browser sessions using Helium, then run /import-browser-profile again." };
		}
		setStage("checking the Helium executable");
		await access(options.executable, constants.X_OK);
		setStage("reading the Helium profile");
		const source = join(options.configHome, "net.imput.helium");
		const localState = await readObject(join(source, "Local State"));
		const profile = record(localState.profile) ? localState.profile.last_used : undefined;
		if (typeof profile !== "string" || !/^(Default|Profile \d+)$/.test(profile)) {
			return { ok: false, message: "Cannot identify Helium's last-used profile. Open and close Helium, then retry." };
		}
		const sourceProfile = join(source, profile);
		if (!(await exists(join(sourceProfile, "Cookies"))) && !(await exists(join(sourceProfile, "Network", "Cookies")))) {
			return { ok: false, message: "The Helium profile has no cookie database to import." };
		}
		setStage("preparing the import directory");
		await mkdir(managedRoot, { recursive: true, mode: 0o700 });
		await chmod(managedRoot, 0o700);
		try { await mkdir(lock, { mode: 0o700 }); locked = true; }
		catch (error) {
			if (hasCode(error, "EEXIST")) return { ok: false, message: `Another import is running. If an earlier import crashed, remove ${lock} after checking it has stopped.` };
			throw error;
		}
		setStage("reading Agent Browser configuration");
		if (await exists(configPath) && (await lstat(configPath)).isSymbolicLink()) {
			return { ok: false, message: "Agent Browser config.json is a symbolic link. Import stopped to preserve your managed configuration." };
		}
		const original = await exists(configPath) ? await readFile(configPath, "utf8") : undefined;
		const config: unknown = original === undefined ? {} : JSON.parse(original);
		if (!record(config) || (config.args !== undefined && typeof config.args !== "string")) {
			return { ok: false, message: "Agent Browser config.json is invalid. Import stopped without replacing it." };
		}
		if (config.cdp || config.autoConnect || config.state || config.provider || config.allowedDomains || (config.engine && config.engine !== "chrome")) {
			return { ok: false, message: "Agent Browser has connection, state, provider or domain-restriction settings that conflict with profile import. Remove those settings explicitly before retrying." };
		}
		setStage("copying the Helium profile");
		staging = await mkdtemp(join(managedRoot, "profile-"));
		await copyPrivate(join(source, "Local State"), join(staging, "Local State"));
		await copyPrivate(sourceProfile, join(staging, profile));
		setStage("rechecking running processes");
		if (await browserOpen(options.procRoot, managedRoot)) {
			return { ok: false, message: "Helium opened during import. Close all Helium instances and retry." };
		}
		setStage("updating Agent Browser configuration");
		const current = await exists(configPath) ? await readFile(configPath, "utf8") : undefined;
		if (current !== original) return { ok: false, message: "Agent Browser configuration changed during import. Retry after the other change finishes." };
		const args = (typeof config.args === "string" ? config.args : "").split(/[,\n]/).map((arg) => arg.trim()).filter(Boolean);
		// The path-based Agent Browser mode otherwise uses its basic password store.
		const preservedArgs = args.filter((arg) => !/^--(?:password-store|profile-directory|user-data-dir)(?:=|\s|$)/.test(arg) && arg !== "--use-mock-keychain");
		const nextConfig = {
			...config,
			profile: staging,
			executablePath: options.executable,
			args: [...preservedArgs, "--password-store=gnome-libsecret", `--profile-directory=${profile}`].join(","),
		};
		configTemp = join(agentRoot, `.helium-config-${basename(staging)}.json`);
		await writeFile(configTemp, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		await rename(configTemp, configPath);
		committed = true;
		// Keep older imports: existing daemons may still refer to them. Never delete an active profile.
		return { ok: true, profile: staging };
	} catch (error) {
		const code = record(error) && typeof error.code === "string" ? ` (${error.code})` : "";
		return { ok: false, message: `Helium import failed while ${stage}${code}. The previous Agent Browser configuration was preserved.` };
	} finally {
		if (!committed && staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
		if (configTemp) await rm(configTemp, { force: true }).catch(() => {});
		if (locked) await rm(lock, { recursive: true, force: true }).catch(() => {});
	}
}
