import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ArtifactConfig {
  apiUrl: string;
  viewerBaseUrl: string;
  publishToken: string;
}

export interface ArtifactRecord {
  artifact: {
    id: string;
    slug: string;
    title: string;
    description: string;
    tags: string[];
    currentVersionId: string;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
  };
  currentVersion: {
    id: string;
    sequence: number;
    sha256: string;
    byteSize: number;
    sourceName: string;
    runtimeMode: "static" | "interactive";
    createdAt: string;
  };
  urls: { viewer: string; immutable: string; api: string };
  unchanged?: boolean;
}

export async function loadArtifactConfig(): Promise<ArtifactConfig> {
  const values = await readShellAssignments(resolve(homedir(), ".config", "artifact-cloud", "config"));
  const apiUrl = (process.env.ARTIFACT_CLOUD_API_URL || values.ARTIFACT_CLOUD_API_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const viewerBaseUrl = (process.env.ARTIFACT_CLOUD_BASE_URL || values.ARTIFACT_CLOUD_BASE_URL || "https://cosmiccruiser.taile9df67.ts.net").replace(/\/+$/, "");
  const publishToken = process.env.ARTIFACT_CLOUD_PUBLISH_TOKEN || values.ARTIFACT_CLOUD_PUBLISH_TOKEN;
  if (!publishToken?.trim()) throw new Error("ARTIFACT_CLOUD_PUBLISH_TOKEN is required in ~/.config/artifact-cloud/config.");
  return { apiUrl, viewerBaseUrl, publishToken };
}

export async function readShellAssignments(path: string): Promise<Record<string, string>> {
  let source: string;
  try { source = await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2]!;
    if (value.includes("$(") || value.includes("`")) throw new Error("Artifact config values must be literal.");
    values[match[1]!] = value;
  }
  return values;
}

export async function apiRequest<T>(config: ArtifactConfig, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.method && options.method !== "GET" ? { authorization: `Bearer ${config.publishToken}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Artifact service returned HTTP ${response.status}.`);
  return body as T;
}

export function resolveLocalPath(cwd: string, inputPath: string): string {
  const expanded = inputPath === "~" || inputPath.startsWith("~/") ? `${homedir()}${inputPath.slice(1)}` : inputPath;
  return resolve(cwd, expanded);
}

export function resolveArtifactIdentifier(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Artifact identifier must not be empty.");
  try {
    const url = new URL(input);
    const match = /^\/(?:a|v1\/artifacts)\/([a-z0-9-]+)\/?$/i.exec(url.pathname);
    if (!match) throw new Error("Use an artifact ID, slug, canonical /a/ URL, or artifact API URL.");
    return match[1]!;
  } catch (error) {
    if (/^[a-z0-9-]+$/i.test(input)) return input;
    if (error instanceof Error && error.message.startsWith("Use an artifact")) throw error;
    throw new Error("Use an artifact ID, slug, canonical /a/ URL, or artifact API URL.");
  }
}

export async function copyUrlToClipboard(url: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("copyUrl is currently supported only on macOS Universal Clipboard.");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(stderr.trim() || `pbcopy exited with status ${code}.`)));
    child.stdin.end(url);
  });
}
