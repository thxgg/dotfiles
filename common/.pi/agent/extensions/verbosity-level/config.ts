import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, rmSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Display verbosity for supported tool rows. This does not change model output. */
export type Verbosity = "low" | "default";

/** Invalid CLI selection. The message never includes the untrusted flag value. */
export class InvalidVerbosityError extends Error {
  readonly _tag = "InvalidVerbosityError";
  /** Create a safe diagnostic for the CLI boundary. */
  constructor() {
    super("Invalid --verbosity. Use --verbosity low or --verbosity default. Verbosity grouping is disabled. Restart with a valid value.");
    this.name = "InvalidVerbosityError";
  }
}

/** Parse an optional CLI flag. Undefined means use the global preference. */
export function parseVerbosity(value: unknown): Verbosity | undefined | InvalidVerbosityError {
  if (value === undefined || value === "low" || value === "default") return value;
  return new InvalidVerbosityError();
}

/** A safe diagnostic for invalid or inaccessible global preferences. */
export class VerbosityStateError extends Error {
  readonly _tag = "VerbosityStateError";
  /** Describe the failed operation without exposing file contents. */
  constructor(operation: "read" | "save", path: string) {
    super(`Cannot ${operation} global verbosity at ${path}. Check the file and its permissions. Use /verbosity low or /verbosity default to save a preference.`);
    this.name = "VerbosityStateError";
  }
}

/** Machine-local preference, outside caches and excluded from Stow. */
export const statePath = () => join(getAgentDir(), "verbosity.local.json");

/** Read a preference. Only an absent file means no saved selection. */
export function loadVerbosity(path = statePath()): Verbosity | undefined | VerbosityStateError {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (value && typeof value === "object" && "verbosity" in value) {
      const selection = parseVerbosity(value.verbosity);
      if (selection === "low" || selection === "default") return selection;
    }
    return new VerbosityStateError("read", path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    return new VerbosityStateError("read", path);
  }
}

/** Atomically replace the preference. Concurrent processes use the last completed write. */
export function persistVerbosity(verbosity: Verbosity, path = statePath()): VerbosityStateError | undefined {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify({ verbosity })}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    return undefined;
  } catch {
    return new VerbosityStateError("save", path);
  } finally {
    try { rmSync(temporary, { force: true }); } catch { /* Preserve the original save diagnostic. */ }
  }
}

/** Observe atomic replacements, including creation of a previously absent file. */
export function watchVerbosity(path: string, changed: () => void): () => void {
  // Polling works across atomic renames and does not require the parent directory to exist.
  watchFile(path, { interval: 250, persistent: false }, changed);
  return () => unwatchFile(path, changed);
}
