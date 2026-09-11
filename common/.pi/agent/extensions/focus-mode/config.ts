import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Display verbosity for supported tool rows. This does not change model output. */
export type Verbosity = "low" | "normal";

/** Invalid CLI selection. The message never includes the untrusted flag value. */
export class InvalidVerbosityError extends Error {
  readonly _tag = "InvalidVerbosityError";
  /** Create a safe diagnostic for the CLI boundary. */
  constructor() {
    super("Invalid --verbosity. Use --verbosity low or --verbosity normal. Focus grouping is disabled. Restart with a valid value.");
    this.name = "InvalidVerbosityError";
  }
}

/** Parse an optional CLI flag. Undefined means legacy saved-state behavior. */
export function parseVerbosity(value: unknown): Verbosity | undefined | InvalidVerbosityError {
  if (value === undefined || value === "low" || value === "normal") return value;
  return new InvalidVerbosityError();
}

/** Resolve the legacy global state file without reading or creating it. */
export const statePath = () => join(getAgentDir(), ".cache", "focus-mode", "state.json");
/** Read legacy state. Missing, unreadable, or malformed state means normal rows. */
export async function loadEnabled(path = statePath()): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return !!value && typeof value === "object" && "enabled" in value && value.enabled === true;
  } catch { return false; }
}
/** Atomically save legacy state. Reject on filesystem failure. */
export async function persistEnabled(enabled: boolean, path = statePath()): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify({ enabled })}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
