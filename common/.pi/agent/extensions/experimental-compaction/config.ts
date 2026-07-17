import { getAgentDir } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";

export type RuntimeState = {
  enabled: boolean;
  updatedAt?: string;
};

export const DEFAULT_STATE: RuntimeState = { enabled: false };

const statePath = () => path.join(getAgentDir(), ".cache", "experimental-compaction", "state.json");

export async function loadState(): Promise<RuntimeState> {
  try {
    const value = JSON.parse(await fs.readFile(statePath(), "utf8")) as Record<string, unknown>;
    return {
      enabled: value.enabled === true,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function persistEnabled(enabled: boolean): Promise<RuntimeState> {
  const state = { enabled, updatedAt: new Date().toISOString() };
  const target = statePath();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
  return state;
}
