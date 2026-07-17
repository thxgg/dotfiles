import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentDefinition } from "./agents.ts";
import type { AgentJobSnapshot, AgentWorktreeMetadata } from "./job-types.ts";
import { isTerminalStatus } from "./job-types.ts";
import type { JobStore } from "./job-store.ts";

function git(cwd: string, args: string[], encoding: BufferEncoding | "buffer" = "utf8"): string | Buffer {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: encoding === "buffer" ? null : encoding,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }) as string | Buffer;
}

export function isWriteCapable(agent: AgentDefinition): boolean {
  if (agent.permissions.edit === "deny" && agent.permissions.write === "deny") return false;
  if (agent.tools) return agent.tools.some((tool) => tool === "edit" || tool === "write");
  return true;
}

export function createAgentWorktree(job: AgentJobSnapshot, agent: AgentDefinition, store: JobStore): AgentWorktreeMetadata | undefined {
  if (!isWriteCapable(agent)) return undefined;
  let gitRoot: string;
  try { gitRoot = String(git(job.cwd, ["rev-parse", "--show-toplevel"])).trim(); }
  catch { return undefined; }
  const dirty = String(git(job.cwd, ["status", "--porcelain=v1", "--untracked-files=all"])).trim();
  if (dirty) throw new Error("Write-capable background agents require a clean Git checkout so their isolated worktree starts from the exact parent state.");
  const baseCommit = String(git(job.cwd, ["rev-parse", "HEAD"])).trim();
  const relativeCwd = path.relative(gitRoot, path.resolve(job.cwd));
  if (relativeCwd.startsWith("..") || path.isAbsolute(relativeCwd)) throw new Error("Agent cwd is outside its Git root.");
  const worktreePath = path.join(store.paths(job.id).dir, "worktree");
  const branch = `pi-agent/${job.id.replace(/^agent-/, "")}`;
  git(gitRoot, ["worktree", "add", "-b", branch, worktreePath, baseCommit]);
  return {
    gitRoot,
    parentCwd: path.resolve(job.cwd),
    path: worktreePath,
    childCwd: relativeCwd ? path.join(worktreePath, relativeCwd) : worktreePath,
    baseCommit,
    branch,
  };
}

function buildPatch(metadata: AgentWorktreeMetadata): Buffer {
  const tracked = git(metadata.path, ["diff", "--binary", metadata.baseCommit], "buffer") as Buffer;
  const untrackedRaw = String(git(metadata.path, ["ls-files", "--others", "--exclude-standard", "-z"]));
  const untracked = untrackedRaw.split("\0").filter(Boolean);
  const chunks: Buffer[] = [tracked];
  for (const relative of untracked) {
    const result = spawnSync("git", ["diff", "--binary", "--no-index", "--", "/dev/null", relative], {
      cwd: metadata.path,
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0 && result.status !== 1) throw result.error ?? new Error(String(result.stderr));
    chunks.push(Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ""));
  }
  return Buffer.concat(chunks);
}

export function applyAgentWorktree(job: AgentJobSnapshot): AgentJobSnapshot {
  if (!isTerminalStatus(job.status)) throw new Error(`Job ${job.id} must finish before its worktree can be applied.`);
  if (!job.worktree) throw new Error(`Job ${job.id} has no isolated worktree.`);
  if (job.worktree.discardedAt) throw new Error(`Job ${job.id} worktree was discarded.`);
  if (job.worktree.appliedAt) return job;
  const patch = buildPatch(job.worktree);
  if (patch.length > 0) {
    execFileSync("git", ["-C", job.worktree.gitRoot, "apply", "--3way", "--whitespace=nowarn", "-"], {
      input: patch,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  return { ...job, worktree: { ...job.worktree, appliedAt: new Date().toISOString() } };
}

export function retainAgentWorktree(job: AgentJobSnapshot): AgentJobSnapshot {
  if (!job.worktree) throw new Error(`Job ${job.id} has no isolated worktree.`);
  return { ...job, worktree: { ...job.worktree, retained: true } };
}

export function discardAgentWorktree(job: AgentJobSnapshot): AgentJobSnapshot {
  if (!isTerminalStatus(job.status)) throw new Error(`Job ${job.id} must finish before its worktree can be discarded.`);
  if (!job.worktree) throw new Error(`Job ${job.id} has no isolated worktree.`);
  if (!job.worktree.discardedAt && fs.existsSync(job.worktree.path)) git(job.worktree.gitRoot, ["worktree", "remove", "--force", job.worktree.path]);
  if (job.worktree.branch) {
    try { git(job.worktree.gitRoot, ["branch", "-D", job.worktree.branch]); } catch { /* preserve checkout cleanup even if branch changed externally */ }
  }
  return { ...job, worktree: { ...job.worktree, discardedAt: new Date().toISOString() } };
}
