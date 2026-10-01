import { CONFIG_DIR_NAME, getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";

/** Summary and automatic refresh settings; activation is session-local. */
export type RecapConfig = {
  auto: boolean;
  debounceMs: number;
  minTurns: number;
  maxChars: number;
  maxInputChars: number;
  model: string;
};

/** Default settings used after the user enables recap. */
export const DEFAULT_CONFIG: RecapConfig = {
  auto: true,
  debounceMs: 30_000,
  minTurns: 1,
  maxChars: 140,
  maxInputChars: 20_000,
  model: "openai-codex/gpt-6-luna",
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

/** Parse supported settings, ignoring legacy activation preferences. */
export function applySettings(config: RecapConfig, value: unknown): RecapConfig {
  const raw = record(value);
  if (!raw) return config;
  return {
    auto: typeof raw.auto === "boolean" ? raw.auto : config.auto,
    debounceMs: numberSetting(raw.debounceMs ?? raw.inactivityMs, config.debounceMs, 30_000, 60_000),
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

/** Read summary settings without reading or writing persistent toggle state. */
export async function loadConfig(ctx: ExtensionContext): Promise<RecapConfig> {
  const globalPromise = readObject(path.join(getAgentDir(), "settings.json"));
  const projectPromise = ctx.isProjectTrusted()
    ? readObject(path.join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"))
    : Promise.resolve(undefined);
  const [global, project] = await Promise.all([globalPromise, projectPromise]);

  let config = applySettings({ ...DEFAULT_CONFIG }, global?.recap);
  config = applySettings(config, project?.recap);
  return config;
}
