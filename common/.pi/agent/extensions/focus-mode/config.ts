import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const statePath = () => join(getAgentDir(), ".cache", "focus-mode", "state.json");
export async function loadEnabled(path = statePath()): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return !!value && typeof value === "object" && "enabled" in value && value.enabled === true;
  } catch { return false; }
}
export async function persistEnabled(enabled: boolean, path = statePath()): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify({ enabled })}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
