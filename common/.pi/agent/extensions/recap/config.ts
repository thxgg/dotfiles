import { CONFIG_DIR_NAME, getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";

export type RecapConfig = {
  enabled: boolean;
  auto: boolean;
  debounceMs: number;
  minTurns: number;
  maxChars: number;
  maxInputChars: number;
  model: string;
};

export const DEFAULT_CONFIG: RecapConfig = {
  enabled: true,
  auto: true,
  debounceMs: 150,
  minTurns: 1,
  maxChars: 180,
  maxInputChars: 20_000,
  model: "openai-codex/gpt-5.6-sol-fast",
};

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

function applySettings(config: RecapConfig, value: unknown): RecapConfig {
  const raw = record(value);
  if (!raw) return config;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : config.enabled,
    auto: typeof raw.auto === "boolean" ? raw.auto : config.auto,
    debounceMs: numberSetting(raw.debounceMs ?? raw.inactivityMs, config.debounceMs, 0, 60_000),
    minTurns: numberSetting(raw.minTurns, config.minTurns, 0, 100),
    maxChars: numberSetting(raw.maxChars, config.maxChars, 40, 1_000),
    maxInputChars: numberSetting(raw.maxInputChars, config.maxInputChars, 4_000, 100_000),
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : config.model,
  };
}

async function readObject(filePath: string): Promise<JsonObject | undefined> {
  try {
    return record(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

const statePath = () => path.join(getAgentDir(), ".cache", "session-recap", "state.json");

export async function loadConfig(ctx: ExtensionContext): Promise<RecapConfig> {
  const globalPromise = readObject(path.join(getAgentDir(), "settings.json"));
  const projectPromise = ctx.isProjectTrusted()
    ? readObject(path.join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"))
    : Promise.resolve(undefined);
  const statePromise = readObject(statePath());
  const [global, project, state] = await Promise.all([globalPromise, projectPromise, statePromise]);

  let config = applySettings({ ...DEFAULT_CONFIG }, global?.recap);
  config = applySettings(config, project?.recap);
  if (typeof state?.enabled === "boolean") config.enabled = state.enabled;
  return config;
}

export async function persistEnabled(enabled: boolean): Promise<void> {
  const target = statePath();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  await fs.rename(temporary, target);
}
