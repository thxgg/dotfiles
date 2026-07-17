import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentJobSnapshot, AgentJobSpec, AgentNotification, StoredJobState } from "./job-types.ts";
import { isTerminalStatus } from "./job-types.ts";

const JOB_ID_PATTERN = /^agent-[a-f0-9]{8,32}$/;
const HISTORY_LIMIT = 50;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

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
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return undefined;
  if (typeof value.id !== "string" || !isValidJobId(value.id)) return undefined;
  if (typeof value.agent !== "string" || typeof value.task !== "string" || typeof value.cwd !== "string") return undefined;
  if (!( ["queued", "running", "waiting", "completed", "failed", "cancelled"] as unknown[]).includes(value.status)) return undefined;
  if (value.backend !== "in-process" && value.backend !== "herdr") return undefined;
  return { ...(value as unknown as StoredJobState), version: 2, attempt: typeof value.attempt === "number" ? value.attempt : 1 };
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

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

export class JobStore {
  readonly root: string;

  constructor(root = defaultJobStoreRoot()) {
    this.root = path.resolve(root);
  }

  paths(jobId: string): { dir: string; state: string; spec: string; prompt: string; lock: string } {
    assertJobId(jobId);
    const dir = path.join(this.root, jobId);
    if (path.dirname(dir) !== this.root) throw new Error(`Unsafe subagent job path: ${jobId}`);
    return {
      dir,
      state: path.join(dir, "state.json"),
      spec: path.join(dir, "spec.json"),
      prompt: path.join(dir, "prompt.md"),
      lock: path.join(dir, ".state.lock"),
    };
  }

  private withLock<T>(jobId: string, operation: () => T): T {
    const { dir, lock } = this.paths(jobId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (true) {
      const token = `${process.pid}:${randomUUID()}`;
      try {
        const fd = fs.openSync(lock, "wx", 0o600);
        try {
          fs.writeFileSync(fd, `${token} ${Date.now()}\n`);
          return operation();
        } finally {
          fs.closeSync(fd);
          try {
            const currentToken = fs.readFileSync(lock, "utf8").trim().split(/\s+/)[0];
            if (currentToken === token) fs.unlinkSync(lock);
          } catch { /* lock was already cleaned */ }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const [ownerToken] = fs.readFileSync(lock, "utf8").trim().split(/\s+/);
          const ownerPid = Number(ownerToken?.split(":")[0]);
          if (Date.now() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS && !isProcessAlive(ownerPid)) {
            fs.unlinkSync(lock);
            continue;
          }
        } catch { continue; }
        if (Date.now() >= deadline) throw new Error(`Timed out acquiring subagent state lock: ${jobId}`);
        sleepSync(10);
      }
    }
  }

  initialize(spec: AgentJobSpec, snapshot: AgentJobSnapshot, prompt: string): void {
    if (spec.jobId !== snapshot.id) throw new Error("Subagent job spec/state id mismatch.");
    const paths = this.paths(snapshot.id);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(paths.dir, { recursive: false, mode: 0o700 });
    try { fs.chmodSync(paths.dir, 0o700); } catch { /* best effort */ }
    fs.writeFileSync(paths.prompt, prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
    writePrivateAtomic(paths.spec, spec);
    this.writeUnlocked(snapshot);
  }

  private writeUnlocked(snapshot: AgentJobSnapshot): void {
    const stored: StoredJobState = { version: 2, ...snapshot, updatedAt: snapshot.updatedAt ?? new Date().toISOString() };
    writePrivateAtomic(this.paths(snapshot.id).state, stored);
  }

  write(snapshot: AgentJobSnapshot): void {
    this.withLock(snapshot.id, () => this.writeUnlocked(snapshot));
  }

  update(jobId: string, updater: (current: AgentJobSnapshot) => AgentJobSnapshot): AgentJobSnapshot | undefined {
    return this.withLock(jobId, () => {
      const current = this.read(jobId);
      if (!current) return undefined;
      const next = updater(current);
      if (next.id !== jobId) throw new Error("Subagent job update changed its id.");
      next.updatedAt = new Date().toISOString();
      this.writeUnlocked(next);
      return next;
    });
  }

  read(jobId: string): AgentJobSnapshot | undefined {
    let raw: string;
    try { raw = fs.readFileSync(this.paths(jobId).state, "utf8"); }
    catch { return undefined; }
    try {
      const state = validateState(JSON.parse(raw));
      if (!state || state.id !== jobId) return undefined;
      const { version: _version, ...snapshot } = state;
      return snapshot;
    } catch { return undefined; }
  }

  readSpecFile(specPath: string): AgentJobSpec {
    const resolved = path.resolve(specPath);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || path.basename(resolved) !== "spec.json") {
      throw new Error("Subagent job spec path is outside the job store.");
    }
    const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as Omit<AgentJobSpec, "version"> & { version: number };
    if ((raw.version !== 1 && raw.version !== 2) || !isValidJobId(raw.jobId)) throw new Error("Unsupported or invalid subagent job spec.");
    const parsed = { ...raw, version: 2 as const } as AgentJobSpec;
    const expected = this.paths(parsed.jobId);
    if (resolved !== expected.spec || path.resolve(parsed.stateDir) !== expected.dir || path.resolve(parsed.promptPath) !== expected.prompt) {
      throw new Error("Subagent job spec contains inconsistent paths.");
    }
    return parsed;
  }

  list(): AgentJobSnapshot[] {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(this.root, { withFileTypes: true }); }
    catch { return []; }
    const jobs: AgentJobSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidJobId(entry.name)) continue;
      const state = this.read(entry.name);
      if (state) jobs.push(state);
    }
    return jobs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  addNotification(jobId: string, notification: Omit<AgentNotification, "state"> & { state?: AgentNotification["state"] }): AgentJobSnapshot | undefined {
    return this.update(jobId, (current) => {
      const notifications = [...(current.notifications ?? [])];
      if (!notifications.some((item) => item.id === notification.id)) notifications.push({ ...notification, state: notification.state ?? "pending" });
      return { ...current, notifications };
    });
  }

  claimNotification(jobId: string, notificationId: string, owner: string, leaseMs = 30_000): AgentJobSnapshot | undefined {
    return this.update(jobId, (current) => {
      const now = Date.now();
      const notifications = (current.notifications ?? []).map((item) => {
        if (item.id !== notificationId || item.state === "delivered" || item.state === "consumed") return item;
        const leaseExpired = !item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= now;
        if (item.state === "delivering" && !leaseExpired && item.leaseOwner !== owner) return item;
        return { ...item, state: "delivering" as const, leaseOwner: owner, leaseExpiresAt: new Date(now + leaseMs).toISOString() };
      });
      return { ...current, notifications };
    });
  }

  completeNotification(jobId: string, notificationId: string, owner: string): AgentJobSnapshot | undefined {
    return this.update(jobId, (current) => ({
      ...current,
      notifications: (current.notifications ?? []).map((item) => item.id === notificationId && item.leaseOwner === owner
        ? { ...item, state: "delivered" as const, deliveredAt: new Date().toISOString(), leaseOwner: undefined, leaseExpiresAt: undefined }
        : item),
    }));
  }

  releaseNotification(jobId: string, notificationId: string, owner: string): AgentJobSnapshot | undefined {
    return this.update(jobId, (current) => ({
      ...current,
      notifications: (current.notifications ?? []).map((item) => item.id === notificationId && item.leaseOwner === owner
        ? { ...item, state: "pending" as const, leaseOwner: undefined, leaseExpiresAt: undefined }
        : item),
    }));
  }

  consumeCompletionNotifications(jobId: string): AgentJobSnapshot | undefined {
    return this.update(jobId, (current) => ({
      ...current,
      notifications: (current.notifications ?? []).map((item) => item.kind === "completion" && item.state !== "delivered"
        ? { ...item, state: "consumed" as const, obsoleteAt: new Date().toISOString(), leaseOwner: undefined, leaseExpiresAt: undefined }
        : item),
    }));
  }

  remove(jobId: string): boolean {
    try { fs.rmSync(this.paths(jobId).dir, { recursive: true, force: true }); return true; }
    catch { return false; }
  }

  prune(limit = HISTORY_LIMIT): string[] {
    const terminal = this.list().filter((job) => isTerminalStatus(job.status)
      && (!job.worktree || Boolean(job.worktree.discardedAt))
      && (job.notifications ?? []).every((notification) => notification.state === "delivered" || notification.state === "consumed" || Boolean(notification.obsoleteAt)));
    const overflow = terminal.length - Math.max(0, limit);
    if (overflow <= 0) return [];
    const removed: string[] = [];
    for (const job of terminal.slice(0, overflow)) if (this.remove(job.id)) removed.push(job.id);
    return removed;
  }
}

export const jobStore = new JobStore();
