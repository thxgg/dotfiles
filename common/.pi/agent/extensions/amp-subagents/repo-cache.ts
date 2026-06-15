import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const ACTIONS = ["ensure_repo", "status", "update_repo"] as const;
const PUBLIC_GIT_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "git.sr.ht",
  "sourcehut.org",
]);

const RepoCacheSchema = Type.Object({
  action: Type.Optional(StringEnum([...ACTIONS], {
    description: "Operation to run. Default: ensure_repo.",
    default: "ensure_repo",
  })),
  url: Type.String({ description: "Public HTTPS git repository URL, for example https://github.com/org/repo." }),
  ref: Type.Optional(Type.String({ description: "Optional branch, tag, or commit to inspect." })),
  searchPath: Type.Optional(Type.String({ description: "Optional path inside the repo to highlight in the result." })),
}, { additionalProperties: false });

type RepoCacheParams = Static<typeof RepoCacheSchema>;
type RepoCacheAction = (typeof ACTIONS)[number];

export interface NormalizedRepoUrl {
  normalizedUrl: string;
  cloneUrl: string;
  host: string;
  pathname: string;
}

export interface RepoMetadata {
  normalizedUrl: string;
  cloneUrl: string;
  cacheKey: string;
  localPath: string;
  host: string;
  defaultBranch?: string;
  currentRef?: string;
  currentCommit?: string;
  fetchedAt?: string;
  searchPaths?: string[];
  packageName?: string;
}

interface MetadataFile {
  version: 1;
  repos: Record<string, RepoMetadata>;
}

export interface RepoCacheResult {
  exists: boolean;
  url: string;
  cloneUrl: string;
  localPath: string;
  cacheKey: string;
  cacheHit: boolean;
  updated: boolean;
  defaultBranch?: string;
  branch?: string;
  requestedRef?: string;
  commit?: string;
  fetchedAt?: string;
  dirty?: boolean;
  searchPath?: string;
  searchPathExists?: boolean;
  metadataPath: string;
  message: string;
}

const locks = new Map<string, Promise<RepoCacheResult>>();

function xdgCacheHome(): string {
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
}

function xdgStateHome(): string {
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
}

export function getRepoCacheRoots() {
  return {
    reposDir: path.join(xdgCacheHome(), "pi", "librarian", "repos"),
    metadataPath: path.join(xdgStateHome(), "pi", "librarian", "repos.json"),
  };
}

function isPrivateIp(hostname: string): boolean {
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 0) return false;
  if (ipVersion === 4) {
    const parts = hostname.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
    const [a, b] = parts as [number, number, number, number];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }

  const normalized = hostname.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

export function normalizeRepoUrl(rawUrl: string): NormalizedRepoUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid repository URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error("repo_cache only accepts public HTTPS repository URLs.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("repo_cache rejects URLs with embedded credentials.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isPrivateIp(host)) {
    throw new Error("repo_cache rejects localhost and private-network repository URLs.");
  }
  if (!PUBLIC_GIT_HOSTS.has(host)) {
    throw new Error(`repo_cache only allows known public git hosts by default. Rejected host: ${host}`);
  }

  const pathname = parsed.pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
  const pathParts = pathname.split("/").filter(Boolean);
  if (pathParts.length < 2) {
    throw new Error("Repository URL must include an owner/group and repository name.");
  }

  const normalizedUrl = `https://${host}/${pathParts.join("/")}`;
  return {
    normalizedUrl,
    cloneUrl: `${normalizedUrl}.git`,
    host,
    pathname: `/${pathParts.join("/")}`,
  };
}

export function validateRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error("ref cannot be empty.");
  if (trimmed.startsWith("-")) throw new Error("ref cannot start with '-'.");
  if (trimmed.includes("..") || trimmed.includes("//") || trimmed.endsWith("/") || trimmed.startsWith("/")) {
    throw new Error(`Unsafe git ref: ${ref}`);
  }
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(trimmed) || trimmed.includes("@{")) {
    throw new Error(`Unsafe git ref: ${ref}`);
  }
  if (trimmed.endsWith(".lock")) throw new Error(`Unsafe git ref: ${ref}`);
  return trimmed;
}

function sanitizeCachePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "repo";
}

function getCacheKey(normalizedUrl: string, host: string, pathname: string): string {
  const digest = createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 12);
  const pathPart = sanitizeCachePart(pathname.replace(/^\//, "").replace(/\.git$/i, ""));
  return `${sanitizeCachePart(host)}-${pathPart}-${digest}`;
}

async function readMetadata(metadataPath: string): Promise<MetadataFile> {
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as MetadataFile;
    if (parsed && parsed.version === 1 && parsed.repos && typeof parsed.repos === "object") return parsed;
  } catch {
    // Missing or malformed metadata starts fresh; individual repo directories remain discoverable.
  }
  return { version: 1, repos: {} };
}

async function writeMetadata(metadataPath: string, metadata: MetadataFile): Promise<void> {
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  const tempPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, metadataPath);
}

function execFileText(command: string, args: string[], options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      signal: options.signal,
      timeout: options.timeout ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
      },
    }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr || (error instanceof Error ? error.message : String(error));
        reject(new Error(message.trim() || `Command failed: ${command} ${args.join(" ")}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function git(args: string[], cwd?: string, signal?: AbortSignal, timeout?: number): Promise<string> {
  const { stdout } = await execFileText("git", args, { cwd, signal, timeout });
  return stdout.trim();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepo(localPath: string): Promise<boolean> {
  if (!(await pathExists(path.join(localPath, ".git")))) return false;
  try {
    await git(["rev-parse", "--git-dir"], localPath, undefined, 10_000);
    return true;
  } catch {
    return false;
  }
}

async function getCurrentCommit(localPath: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    return await git(["rev-parse", "HEAD"], localPath, signal, 10_000);
  } catch {
    return undefined;
  }
}

async function getCurrentBranch(localPath: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    return (await git(["branch", "--show-current"], localPath, signal, 10_000)) || undefined;
  } catch {
    return undefined;
  }
}

async function getDefaultBranch(localPath: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const remoteHead = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], localPath, signal, 10_000);
    return remoteHead.replace(/^origin\//, "") || undefined;
  } catch {
    return undefined;
  }
}

async function isDirty(localPath: string, signal?: AbortSignal): Promise<boolean> {
  try {
    return Boolean(await git(["status", "--porcelain"], localPath, signal, 10_000));
  } catch {
    return false;
  }
}

async function resolveCommit(localPath: string, ref: string, signal?: AbortSignal): Promise<string> {
  const safeRef = validateRef(ref);
  const candidates = [safeRef, `origin/${safeRef}`];
  for (const candidate of candidates) {
    try {
      return await git(["rev-parse", "--verify", `${candidate}^{commit}`], localPath, signal, 10_000);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`Could not resolve ref ${ref} in cached repository.`);
}

async function checkoutRef(localPath: string, ref: string, signal?: AbortSignal): Promise<string> {
  if (await isDirty(localPath, signal)) {
    throw new Error(`Cached repository has local modifications: ${localPath}`);
  }

  const safeRef = validateRef(ref);
  try {
    await git(["fetch", "--tags", "origin", safeRef], localPath, signal, 180_000);
  } catch {
    await git(["fetch", "--tags", "origin"], localPath, signal, 180_000);
  }

  const commit = await resolveCommit(localPath, safeRef, signal);
  await git(["checkout", "--detach", commit], localPath, signal, 60_000);
  return commit;
}

async function updateDefaultBranch(localPath: string, signal?: AbortSignal): Promise<{ branch?: string; commit?: string; changed: boolean }> {
  if (await isDirty(localPath, signal)) {
    throw new Error(`Cached repository has local modifications: ${localPath}`);
  }

  const before = await getCurrentCommit(localPath, signal);
  await git(["fetch", "--tags", "--prune", "origin"], localPath, signal, 180_000);
  const defaultBranch = (await getDefaultBranch(localPath, signal)) ?? (await getCurrentBranch(localPath, signal));
  if (defaultBranch) {
    try {
      await git(["checkout", defaultBranch], localPath, signal, 60_000);
    } catch {
      await git(["checkout", "-B", defaultBranch, `origin/${defaultBranch}`], localPath, signal, 60_000);
    }
    await git(["pull", "--ff-only", "origin", defaultBranch], localPath, signal, 180_000);
  }
  const after = await getCurrentCommit(localPath, signal);
  return { branch: defaultBranch, commit: after, changed: before !== after };
}

async function summarizeRepo(localPath: string, signal?: AbortSignal) {
  const [branch, commit, defaultBranch, dirty] = await Promise.all([
    getCurrentBranch(localPath, signal),
    getCurrentCommit(localPath, signal),
    getDefaultBranch(localPath, signal),
    isDirty(localPath, signal),
  ]);
  return { branch, commit, defaultBranch, dirty };
}

function formatResult(result: RepoCacheResult): string {
  const lines = [result.message, `Repository: ${result.url}`, `Cache: ${result.localPath}`];
  if (result.requestedRef) lines.push(`Requested ref: ${result.requestedRef}`);
  if (result.branch) lines.push(`Branch: ${result.branch}`);
  if (result.commit) lines.push(`Commit: ${result.commit}`);
  if (result.defaultBranch) lines.push(`Default branch: ${result.defaultBranch}`);
  lines.push(`Cache hit: ${result.cacheHit ? "yes" : "no"}`);
  lines.push(`Updated: ${result.updated ? "yes" : "no"}`);
  if (result.dirty !== undefined) lines.push(`Dirty: ${result.dirty ? "yes" : "no"}`);
  if (result.searchPath) lines.push(`Search path: ${path.join(result.localPath, result.searchPath)} (${result.searchPathExists ? "exists" : "missing"})`);
  lines.push(`Metadata: ${result.metadataPath}`);
  return lines.join("\n");
}

async function withRepoLock(key: string, fn: () => Promise<RepoCacheResult>): Promise<RepoCacheResult> {
  const previous = locks.get(key);
  const run = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(fn);
  locks.set(key, run.finally(() => {
    if (locks.get(key) === run) locks.delete(key);
  }));
  return run;
}

async function updateMetadata(result: RepoCacheResult, normalized: NormalizedRepoUrl): Promise<void> {
  const metadata = await readMetadata(result.metadataPath);
  const existing = metadata.repos[normalized.normalizedUrl];
  const searchPaths = new Set(existing?.searchPaths ?? []);
  if (result.searchPath) searchPaths.add(result.searchPath);

  metadata.repos[normalized.normalizedUrl] = {
    normalizedUrl: normalized.normalizedUrl,
    cloneUrl: normalized.cloneUrl,
    cacheKey: result.cacheKey,
    localPath: result.localPath,
    host: normalized.host,
    defaultBranch: result.defaultBranch,
    currentRef: result.requestedRef ?? result.branch,
    currentCommit: result.commit,
    fetchedAt: result.fetchedAt,
    searchPaths: Array.from(searchPaths).sort(),
  };
  await writeMetadata(result.metadataPath, metadata);
}

export async function runRepoCache(params: RepoCacheParams, signal?: AbortSignal): Promise<RepoCacheResult> {
  const action = params.action ?? "ensure_repo";
  const normalized = normalizeRepoUrl(params.url);
  const { reposDir, metadataPath } = getRepoCacheRoots();
  const cacheKey = getCacheKey(normalized.normalizedUrl, normalized.host, normalized.pathname);
  const localPath = path.join(reposDir, cacheKey);
  const requestedRef = params.ref ? validateRef(params.ref) : undefined;
  const searchPath = params.searchPath?.replace(/^\/+/, "");

  return withRepoLock(cacheKey, async () => {
    await fs.mkdir(reposDir, { recursive: true });
    const existedBefore = await isGitRepo(localPath);

    let updated = false;
    let message: string;

    if (action === "status") {
      if (!existedBefore) {
        return {
          exists: false,
          url: normalized.normalizedUrl,
          cloneUrl: normalized.cloneUrl,
          localPath,
          cacheKey,
          cacheHit: false,
          updated: false,
          requestedRef,
          searchPath,
          metadataPath,
          message: "Repository is not cached.",
        };
      }
      message = "Repository is cached.";
    } else {
      if (!existedBefore) {
        await git(["clone", normalized.cloneUrl, localPath], undefined, signal, 600_000);
        updated = true;
        message = "Repository cloned into cache.";
      } else if (action === "update_repo") {
        if (requestedRef) {
          const before = await getCurrentCommit(localPath, signal);
          const after = await checkoutRef(localPath, requestedRef, signal);
          updated = before !== after;
          message = updated ? "Repository fetched and checked out requested ref." : "Repository already at requested ref.";
        } else {
          const update = await updateDefaultBranch(localPath, signal);
          updated = update.changed;
          message = updated ? "Repository updated from origin." : "Repository already up to date.";
        }
      } else if (requestedRef) {
        const before = await getCurrentCommit(localPath, signal);
        const after = await checkoutRef(localPath, requestedRef, signal);
        updated = before !== after;
        message = existedBefore
          ? (updated ? "Repository cache reused and checked out requested ref." : "Repository cache reused at requested ref.")
          : "Repository cloned and checked out requested ref.";
      } else {
        message = "Repository cache reused without update.";
      }

      if (!existedBefore && requestedRef) {
        await checkoutRef(localPath, requestedRef, signal);
      }
    }

    const summary = await summarizeRepo(localPath, signal);
    const result: RepoCacheResult = {
      exists: true,
      url: normalized.normalizedUrl,
      cloneUrl: normalized.cloneUrl,
      localPath,
      cacheKey,
      cacheHit: existedBefore,
      updated,
      requestedRef,
      branch: summary.branch,
      commit: summary.commit,
      defaultBranch: summary.defaultBranch,
      dirty: summary.dirty,
      fetchedAt: new Date().toISOString(),
      searchPath,
      searchPathExists: searchPath ? await pathExists(path.join(localPath, searchPath)) : undefined,
      metadataPath,
      message,
    };

    await updateMetadata(result, normalized);
    return result;
  });
}

function normalizeAction(action: unknown): RepoCacheAction | undefined {
  if (action === "repo_status") return "status";
  if (action === "ensure") return "ensure_repo";
  if (action === "update") return "update_repo";
  return ACTIONS.includes(action as RepoCacheAction) ? (action as RepoCacheAction) : undefined;
}

export function registerRepoCacheTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "repo_cache",
    label: "Repo Cache",
    description: "Clone, update, locate, and status-check public source repositories in Pi's global librarian cache. Cache writes happen only under ~/.cache/pi/librarian/repos by default.",
    promptSnippet: "Clone/reuse public upstream source repositories in Pi's global librarian cache for source-first research",
    promptGuidelines: [
      "Use repo_cache before browsing public repository files over the network when researching upstream source.",
      "repo_cache only accepts public HTTPS repository URLs and rejects credentials, localhost, and private-network URLs.",
    ],
    parameters: RepoCacheSchema,
    prepareArguments(args) {
      if (!args || typeof args !== "object") return args as RepoCacheParams;
      const input = args as Record<string, unknown>;
      const action = normalizeAction(input.action ?? input.operation ?? input.op);
      return {
        ...input,
        ...(action ? { action } : {}),
      } as RepoCacheParams;
    },
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const result = await runRepoCache(params, signal);
      return {
        content: [{ type: "text", text: formatResult(result) }],
        details: result,
      };
    },
    renderCall(args, theme) {
      const action = args.action ?? "ensure_repo";
      let text = theme.fg("toolTitle", theme.bold("repo_cache "));
      text += theme.fg("accent", action);
      text += theme.fg("muted", ` ${args.url}`);
      if (args.ref) text += theme.fg("muted", ` @ ${args.ref}`);
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as RepoCacheResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "repo_cache complete", 0, 0);
      }
      let text = `${theme.fg(details.exists ? "success" : "warning", details.exists ? "✓" : "○")} ${theme.fg("toolTitle", details.cacheHit ? "cache" : "repo")}`;
      text += theme.fg("accent", ` ${details.updated ? "updated" : details.cacheHit ? "reused" : "ready"}`);
      text += theme.fg("muted", ` ${details.localPath}`);
      if (details.commit) text += theme.fg("dim", ` ${details.commit.slice(0, 12)}`);
      if (expanded) text += `\n${formatResult(details)}`;
      return new Text(text, 0, 0);
    },
  });
}
