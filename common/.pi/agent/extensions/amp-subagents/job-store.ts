import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentJobSnapshot, AgentJobSpec, StoredJobState } from "./job-types.ts";
import { isTerminalStatus } from "./job-types.ts";

const JOB_ID_PATTERN = /^agent-[a-f0-9]{8,32}$/;
const HISTORY_LIMIT = 50;

export function defaultJobStoreRoot(): string {
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "pi", "subagents");
}

export function isValidJobId(jobId: string): boolean {
  return JOB_ID_PATTERN.test(jobId);
}

function assertJobId(jobId: string): void {
  if (!isValidJobId(jobId)) throw new Error(`Invalid subagent job id: ${jobId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateState(value: unknown): StoredJobState | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  if (typeof value.id !== "string" || !isValidJobId(value.id)) return undefined;
  if (typeof value.agent !== "string" || typeof value.task !== "string" || typeof value.cwd !== "string") return undefined;
  if (!(["queued", "running", "completed", "failed", "cancelled"] as unknown[]).includes(value.status)) return undefined;
  if (value.backend !== "in-process" && value.backend !== "herdr") return undefined;
  return value as unknown as StoredJobState;
}

function writePrivateAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort on non-POSIX filesystems */ }
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(tempPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* renamed or already absent */ }
  }
}

export class JobStore {
  readonly root: string;

  constructor(root = defaultJobStoreRoot()) {
    this.root = path.resolve(root);
  }

  paths(jobId: string): { dir: string; state: string; spec: string; prompt: string } {
    assertJobId(jobId);
    const dir = path.join(this.root, jobId);
    if (path.dirname(dir) !== this.root) throw new Error(`Unsafe subagent job path: ${jobId}`);
    return {
      dir,
      state: path.join(dir, "state.json"),
      spec: path.join(dir, "spec.json"),
      prompt: path.join(dir, "prompt.md"),
    };
  }

  initialize(spec: AgentJobSpec, snapshot: AgentJobSnapshot, prompt: string): void {
    if (spec.jobId !== snapshot.id) throw new Error("Subagent job spec/state id mismatch.");
    const paths = this.paths(snapshot.id);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(paths.dir, { recursive: false, mode: 0o700 });
    try { fs.chmodSync(paths.dir, 0o700); } catch { /* best effort */ }
    fs.writeFileSync(paths.prompt, prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
    writePrivateAtomic(paths.spec, spec);
    this.write(snapshot);
  }

  write(snapshot: AgentJobSnapshot): void {
    const stored: StoredJobState = {
      version: 1,
      ...snapshot,
      updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
    };
    writePrivateAtomic(this.paths(snapshot.id).state, stored);
  }

  update(jobId: string, updater: (current: AgentJobSnapshot) => AgentJobSnapshot): AgentJobSnapshot | undefined {
    const current = this.read(jobId);
    if (!current) return undefined;
    const next = updater(current);
    if (next.id !== jobId) throw new Error("Subagent job update changed its id.");
    next.updatedAt = new Date().toISOString();
    this.write(next);
    return next;
  }

  read(jobId: string): AgentJobSnapshot | undefined {
    let raw: string;
    try {
      raw = fs.readFileSync(this.paths(jobId).state, "utf8");
    } catch {
      return undefined;
    }
    try {
      const state = validateState(JSON.parse(raw));
      if (!state || state.id !== jobId) return undefined;
      const { version: _version, ...snapshot } = state;
      return snapshot;
    } catch {
      return undefined;
    }
  }

  readSpecFile(specPath: string): AgentJobSpec {
    const resolved = path.resolve(specPath);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || path.basename(resolved) !== "spec.json") {
      throw new Error("Subagent job spec path is outside the job store.");
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as AgentJobSpec;
    if (parsed.version !== 1 || !isValidJobId(parsed.jobId)) throw new Error("Unsupported or invalid subagent job spec.");
    const expected = this.paths(parsed.jobId);
    if (resolved !== expected.spec || path.resolve(parsed.stateDir) !== expected.dir || path.resolve(parsed.promptPath) !== expected.prompt) {
      throw new Error("Subagent job spec contains inconsistent paths.");
    }
    return parsed;
  }

  list(): AgentJobSnapshot[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const jobs: AgentJobSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidJobId(entry.name)) continue;
      const state = this.read(entry.name);
      if (state) jobs.push(state);
    }
    return jobs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  remove(jobId: string): boolean {
    try {
      fs.rmSync(this.paths(jobId).dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  prune(limit = HISTORY_LIMIT): string[] {
    const terminal = this.list().filter((job) => isTerminalStatus(job.status));
    const overflow = terminal.length - Math.max(0, limit);
    if (overflow <= 0) return [];
    const removed: string[] = [];
    for (const job of terminal.slice(0, overflow)) {
      if (this.remove(job.id)) removed.push(job.id);
    }
    return removed;
  }
}

export const jobStore = new JobStore();
