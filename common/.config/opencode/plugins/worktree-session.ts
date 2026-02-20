import type { Plugin, ToolContext } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const WORKTREE_BASE_DIR = join(
    homedir(),
    ".local",
    "share",
    "opencode",
    "worktree",
);
const DB_BASE_DIR = join(
    homedir(),
    ".local",
    "share",
    "opencode",
    "plugins",
    "worktree-session",
);

const DEFAULT_BASE_BRANCHES = ["origin/main", "origin/master", "main", "master", "trunk"];

type CommandResult = {
    ok: boolean;
    code: number;
    stdout: string;
    stderr: string;
};

type RepoContext = {
    repoRoot: string;
    projectScope: string;
    projectScopeDir: string;
};

type WorktreeEntry = {
    path: string;
    branch?: string;
};

type MappingRecord = {
    branch: string;
    branchSlug: string;
    worktreePath: string;
    parentSessionID: string;
    forkedSessionID: string;
    status: "active" | "archived" | "removed" | "stale";
    createdAt: string;
    updatedAt: string;
};

type LaunchResult = {
    opened: boolean;
    method?: "tmux" | "ghostty";
    error?: string;
    fallbackCommand: string;
};

function toText(value: Uint8Array | string | null | undefined): string {
    if (typeof value === "string") return value;
    if (!value) return "";
    return Buffer.from(value).toString("utf8");
}

function runCommand(args: string[], cwd: string): CommandResult {
    try {
        const result = Bun.spawnSync(args, {
            cwd,
            stdout: "pipe",
            stderr: "pipe",
        });

        return {
            ok: result.exitCode === 0,
            code: result.exitCode,
            stdout: toText(result.stdout).trim(),
            stderr: toText(result.stderr).trim(),
        };
    } catch (error) {
        return {
            ok: false,
            code: 1,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
        };
    }
}

function runGit(cwd: string, ...args: string[]): CommandResult {
    return runCommand(["git", ...args], cwd);
}

function commandExists(command: string): boolean {
    return runCommand(["which", command], process.cwd()).ok;
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function fallbackSessionCommand(worktreePath: string, sessionID: string): string {
    return `cd ${shellQuote(worktreePath)} && opencode --session ${sessionID}`;
}

function normalizePath(pathValue: string): string {
    return resolve(pathValue);
}

function normalizePathWithRealpath(pathValue: string): string {
    const resolved = resolve(pathValue);
    if (!existsSync(resolved)) return resolved;
    try {
        return realpathSync(resolved);
    } catch {
        return resolved;
    }
}

function slugifySegment(value: string): string {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
    return slug || "repo";
}

function branchToDirectorySlug(branch: string): string {
    const slug = branch
        .trim()
        .replace(/^refs\/heads\//, "")
        .replace(/[\/\\]+/g, "--")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "")
        .toLowerCase();

    return slug || `wt-${randomBytes(4).toString("hex")}`;
}

function parseShortcutStoryID(input: string): string | undefined {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }

    const shortcutMatch = trimmed.match(/shortcut\.com\/[^/\s]+\/story\/(\d+)/i);
    if (shortcutMatch?.[1]) {
        return shortcutMatch[1];
    }

    return undefined;
}

function sanitizeBranchName(rawBranch: string): string {
    const cleaned = rawBranch
        .trim()
        .replace(/^refs\/heads\//, "")
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9._\/-]+/g, "-")
        .replace(/\/{2,}/g, "/")
        .replace(/^-+/, "")
        .replace(/-+$/, "");

    if (!cleaned) {
        return `wt/${randomBytes(4).toString("hex")}`;
    }

    return cleaned;
}

function resolveBranchFromRef(ref?: string): { branch: string; source: string } {
    const trimmed = ref?.trim() || "";
    if (!trimmed) {
        return {
            branch: `wt/${randomBytes(4).toString("hex")}`,
            source: "scratch",
        };
    }

    const storyID = parseShortcutStoryID(trimmed);
    if (storyID) {
        return {
            branch: `sc-${storyID}`,
            source: "story-fallback",
        };
    }

    return {
        branch: sanitizeBranchName(trimmed),
        source: "branch",
    };
}

function parseWorktreeList(raw: string): WorktreeEntry[] {
    const lines = raw.split("\n");
    const result: WorktreeEntry[] = [];
    let current: WorktreeEntry | undefined;

    for (const line of lines) {
        if (line.startsWith("worktree ")) {
            if (current) {
                result.push(current);
            }
            current = { path: line.slice("worktree ".length).trim() };
            continue;
        }

        if (!current) continue;

        if (line.startsWith("branch ")) {
            const branchRef = line.slice("branch ".length).trim();
            current.branch = branchRef.replace(/^refs\/heads\//, "");
            continue;
        }
    }

    if (current) {
        result.push(current);
    }

    return result;
}

function getRepoContext(directory: string): { context?: RepoContext; error?: string } {
    const toplevel = runGit(directory, "rev-parse", "--show-toplevel");
    if (!toplevel.ok || !toplevel.stdout) {
        return {
            error: toplevel.stderr || "Not inside a git repository.",
        };
    }

    const repoRoot = normalizePathWithRealpath(toplevel.stdout);

    const commonDir = runGit(directory, "rev-parse", "--git-common-dir");
    const commonDirPath = commonDir.stdout
        ? normalizePathWithRealpath(resolve(repoRoot, commonDir.stdout))
        : normalizePathWithRealpath(join(repoRoot, ".git"));

    const repoName = slugifySegment(basename(repoRoot));
    const hash = createHash("sha256").update(commonDirPath).digest("hex").slice(0, 12);
    const projectScope = `${repoName}-${hash}`;

    return {
        context: {
            repoRoot,
            projectScope,
            projectScopeDir: join(WORKTREE_BASE_DIR, projectScope),
        },
    };
}

function openDatabase(projectScope: string): Database {
    mkdirSync(DB_BASE_DIR, { recursive: true });
    const dbPath = join(DB_BASE_DIR, `${projectScope}.sqlite`);
    const db = new Database(dbPath);

    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(`
        CREATE TABLE IF NOT EXISTS worktree_sessions (
            branch TEXT PRIMARY KEY,
            branch_slug TEXT NOT NULL,
            worktree_path TEXT NOT NULL,
            parent_session_id TEXT NOT NULL,
            forked_session_id TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);

    db.exec("CREATE INDEX IF NOT EXISTS idx_worktree_sessions_path ON worktree_sessions(worktree_path)");
    db.exec(
        "CREATE INDEX IF NOT EXISTS idx_worktree_sessions_forked ON worktree_sessions(forked_session_id)",
    );

    return db;
}

function rowToMapping(row: any): MappingRecord {
    return {
        branch: String(row.branch),
        branchSlug: String(row.branch_slug),
        worktreePath: String(row.worktree_path),
        parentSessionID: String(row.parent_session_id),
        forkedSessionID: String(row.forked_session_id),
        status: String(row.status) as MappingRecord["status"],
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

function getAllMappings(db: Database): MappingRecord[] {
    const rows = db
        .query(
            `
            SELECT branch, branch_slug, worktree_path, parent_session_id, forked_session_id, status, created_at, updated_at
            FROM worktree_sessions
            ORDER BY updated_at DESC
        `,
        )
        .all() as any[];
    return rows.map(rowToMapping);
}

function getMappingByBranch(db: Database, branch: string): MappingRecord | undefined {
    const row = db
        .query(
            `
            SELECT branch, branch_slug, worktree_path, parent_session_id, forked_session_id, status, created_at, updated_at
            FROM worktree_sessions
            WHERE branch = ?
            LIMIT 1
        `,
        )
        .get(branch);

    if (!row) return undefined;
    return rowToMapping(row);
}

function getMappingByForkedSession(db: Database, sessionID: string): MappingRecord | undefined {
    const row = db
        .query(
            `
            SELECT branch, branch_slug, worktree_path, parent_session_id, forked_session_id, status, created_at, updated_at
            FROM worktree_sessions
            WHERE forked_session_id = ?
            LIMIT 1
        `,
        )
        .get(sessionID);

    if (!row) return undefined;
    return rowToMapping(row);
}

function getLatestMappingByParentSession(db: Database, sessionID: string): MappingRecord | undefined {
    const row = db
        .query(
            `
            SELECT branch, branch_slug, worktree_path, parent_session_id, forked_session_id, status, created_at, updated_at
            FROM worktree_sessions
            WHERE parent_session_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
        `,
        )
        .get(sessionID);

    if (!row) return undefined;
    return rowToMapping(row);
}

function getMappingByPath(db: Database, worktreePath: string): MappingRecord | undefined {
    const normalized = normalizePathWithRealpath(worktreePath);
    const rows = db
        .query(
            `
            SELECT branch, branch_slug, worktree_path, parent_session_id, forked_session_id, status, created_at, updated_at
            FROM worktree_sessions
        `,
        )
        .all() as any[];

    return rows
        .map(rowToMapping)
        .find((entry) => normalizePathWithRealpath(entry.worktreePath) === normalized);
}

function upsertMapping(db: Database, mapping: MappingRecord): void {
    db.query(
        `
        INSERT INTO worktree_sessions (
            branch,
            branch_slug,
            worktree_path,
            parent_session_id,
            forked_session_id,
            status,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(branch) DO UPDATE SET
            branch_slug = excluded.branch_slug,
            worktree_path = excluded.worktree_path,
            parent_session_id = excluded.parent_session_id,
            forked_session_id = excluded.forked_session_id,
            status = excluded.status,
            updated_at = excluded.updated_at
    `,
    ).run(
        mapping.branch,
        mapping.branchSlug,
        mapping.worktreePath,
        mapping.parentSessionID,
        mapping.forkedSessionID,
        mapping.status,
        mapping.createdAt,
        mapping.updatedAt,
    );
}

function updateMappingStatus(db: Database, branch: string, status: MappingRecord["status"]): void {
    db.query(
        `
        UPDATE worktree_sessions
        SET status = ?, updated_at = ?
        WHERE branch = ?
    `,
    ).run(status, new Date().toISOString(), branch);
}

function extractErrorMessage(error: unknown): string {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;
    if (typeof error === "object" && "message" in error && typeof error.message === "string") {
        return error.message;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function unwrapData<T>(result: any): T {
    if (result && typeof result === "object" && "data" in result) {
        if (result.error) {
            throw new Error(extractErrorMessage(result.error));
        }
        return result.data as T;
    }

    return result as T;
}

async function sessionExists(client: any, sessionID: string, directory: string): Promise<boolean> {
    if (!sessionID) return false;
    try {
        const result = await client.session.get({
            path: { id: sessionID },
            query: { directory },
        });
        const session = unwrapData<any>(result);
        return Boolean(session?.id);
    } catch {
        return false;
    }
}

async function forkSession(client: any, parentSessionID: string, directory: string): Promise<string> {
    try {
        const result = await client.session.fork({
            path: { id: parentSessionID },
            query: { directory },
        });
        const session = unwrapData<any>(result);
        if (typeof session?.id === "string" && session.id.length > 0) {
            return session.id;
        }
    } catch {
        // Fall through to create as a backup.
    }

    const createResult = await client.session.create({
        body: { parentID: parentSessionID },
        query: { directory },
    });
    const created = unwrapData<any>(createResult);
    if (typeof created?.id !== "string" || created.id.length === 0) {
        throw new Error("Failed to create forked session");
    }
    return created.id;
}

function isTmuxContext(): boolean {
    return Boolean(process.env.TMUX) && commandExists("tmux");
}

function openWithTmux(worktreePath: string, sessionID: string, branchSlug: string): LaunchResult {
    const fallbackCommand = fallbackSessionCommand(worktreePath, sessionID);
    const windowName = `wt-${branchSlug}`.slice(0, 28);
    const tmuxCommand = `opencode --session ${sessionID}`;
    const result = runCommand(
        ["tmux", "new-window", "-n", windowName, "-c", worktreePath, tmuxCommand],
        worktreePath,
    );

    if (!result.ok) {
        return {
            opened: false,
            error: result.stderr || "Failed to open tmux window.",
            fallbackCommand,
        };
    }

    return {
        opened: true,
        method: "tmux",
        fallbackCommand,
    };
}

function openWithGhostty(worktreePath: string, sessionID: string): LaunchResult {
    const fallbackCommand = fallbackSessionCommand(worktreePath, sessionID);

    if (process.platform === "darwin") {
        const openResult = runCommand(
            [
                "open",
                "-na",
                "Ghostty.app",
                "--args",
                `--working-directory=${worktreePath}`,
                "-e",
                "opencode",
                "--session",
                sessionID,
            ],
            worktreePath,
        );

        if (openResult.ok) {
            return {
                opened: true,
                method: "ghostty",
                fallbackCommand,
            };
        }
    }

    if (commandExists("ghostty")) {
        const cliResult = runCommand(
            ["ghostty", "--working-directory", worktreePath, "-e", "opencode", "--session", sessionID],
            worktreePath,
        );
        if (cliResult.ok) {
            return {
                opened: true,
                method: "ghostty",
                fallbackCommand,
            };
        }

        return {
            opened: false,
            error: cliResult.stderr || "Failed to open Ghostty.",
            fallbackCommand,
        };
    }

    return {
        opened: false,
        error: "Ghostty is not available on PATH.",
        fallbackCommand,
    };
}

function launchSession(worktreePath: string, sessionID: string, branchSlug: string): LaunchResult {
    if (isTmuxContext()) {
        const tmuxResult = openWithTmux(worktreePath, sessionID, branchSlug);
        if (tmuxResult.opened) return tmuxResult;
    }

    return openWithGhostty(worktreePath, sessionID);
}

function resolveBaseRef(repoRoot: string, requestedBase?: string): string {
    const candidates = requestedBase ? [requestedBase, ...DEFAULT_BASE_BRANCHES] : DEFAULT_BASE_BRANCHES;

    for (const candidate of candidates) {
        const verify = runGit(repoRoot, "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`);
        if (verify.ok) {
            return candidate;
        }
    }

    const currentBranch = runGit(repoRoot, "branch", "--show-current");
    if (currentBranch.ok && currentBranch.stdout) {
        return currentBranch.stdout;
    }

    return "HEAD";
}

function listRemoteTrackingRefs(repoRoot: string, branch: string): string[] {
    const refsResult = runGit(
        repoRoot,
        "for-each-ref",
        "--format=%(refname)",
        `refs/remotes/*/${branch}`,
    );

    if (!refsResult.ok || !refsResult.stdout) {
        return [];
    }

    return refsResult.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.endsWith("/HEAD"));
}

function createWorktree(
    repoRoot: string,
    branch: string,
    destinationPath: string,
    requestedBase?: string,
): { ok: boolean; mode?: string; baseRef?: string; error?: string } {
    const localBranchExists = runGit(
        repoRoot,
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${branch}`,
    ).ok;

    if (localBranchExists) {
        const result = runGit(repoRoot, "worktree", "add", destinationPath, branch);
        return {
            ok: result.ok,
            mode: "existing-local",
            error: result.ok ? undefined : (result.stderr || "Failed to add worktree from existing branch."),
        };
    }

    const remoteRefs = listRemoteTrackingRefs(repoRoot, branch);
    if (remoteRefs.length > 1) {
        return {
            ok: false,
            error: `Branch exists on multiple remotes (${remoteRefs.join(", ")}). Use an explicit branch ref.`,
        };
    }

    if (remoteRefs.length === 1) {
        const remoteRef = remoteRefs[0];
        if (!remoteRef) {
            return {
                ok: false,
                error: "Remote tracking branch lookup failed unexpectedly.",
            };
        }

        const result = runGit(repoRoot, "worktree", "add", "-b", branch, destinationPath, remoteRef);
        return {
            ok: result.ok,
            mode: "tracking-remote",
            baseRef: remoteRef,
            error: result.ok ? undefined : (result.stderr || "Failed to add worktree from remote tracking branch."),
        };
    }

    const baseRef = resolveBaseRef(repoRoot, requestedBase);
    const createResult = runGit(repoRoot, "worktree", "add", "-b", branch, destinationPath, baseRef);
    return {
        ok: createResult.ok,
        mode: "new-branch",
        baseRef,
        error: createResult.ok
            ? undefined
            : (createResult.stderr || `Failed to create branch ${branch} from ${baseRef}.`),
    };
}

function formatLaunchDetails(launch: LaunchResult): string[] {
    if (launch.opened) {
        return [`opened: yes (${launch.method || "terminal"})`];
    }

    const details = ["opened: no"];
    if (launch.error) {
        details.push(`open_error: ${launch.error}`);
    }
    details.push(`run: ${launch.fallbackCommand}`);
    return details;
}

function resolveMapping(
    db: Database,
    ref: string | undefined,
    context: ToolContext,
): MappingRecord | undefined {
    const trimmed = ref?.trim();
    if (!trimmed) {
        return (
            getMappingByForkedSession(db, context.sessionID)
            || getMappingByPath(db, context.worktree)
            || getLatestMappingByParentSession(db, context.sessionID)
        );
    }

    if (trimmed.startsWith("ses")) {
        return getMappingByForkedSession(db, trimmed) || getLatestMappingByParentSession(db, trimmed);
    }

    if (trimmed.startsWith("/") || trimmed.startsWith("~/")) {
        const absolutePath = trimmed.startsWith("~/")
            ? join(homedir(), trimmed.slice(2))
            : normalizePath(trimmed);
        return getMappingByPath(db, absolutePath);
    }

    const sanitizedBranch = sanitizeBranchName(trimmed);
    return getMappingByBranch(db, sanitizedBranch);
}

function listGitWorktrees(repoRoot: string): { entries: WorktreeEntry[]; error?: string } {
    const result = runGit(repoRoot, "worktree", "list", "--porcelain");
    if (!result.ok) {
        return {
            entries: [],
            error: result.stderr || "Failed to list git worktrees.",
        };
    }

    return {
        entries: parseWorktreeList(result.stdout),
    };
}

function findWorktreeByBranch(entries: WorktreeEntry[], branch: string): WorktreeEntry | undefined {
    return entries.find((entry) => entry.branch === branch);
}

function findWorktreeByPath(entries: WorktreeEntry[], targetPath: string): WorktreeEntry | undefined {
    const normalizedTarget = normalizePathWithRealpath(targetPath);
    return entries.find((entry) => normalizePathWithRealpath(entry.path) === normalizedTarget);
}

async function ensureMappingSession(
    db: Database,
    mapping: MappingRecord,
    context: ToolContext,
    client: any,
): Promise<{ sessionID: string; recreated: boolean }> {
    if (await sessionExists(client, mapping.forkedSessionID, mapping.worktreePath)) {
        return {
            sessionID: mapping.forkedSessionID,
            recreated: false,
        };
    }

    const parentSessionID = (await sessionExists(client, mapping.parentSessionID, context.directory))
        ? mapping.parentSessionID
        : context.sessionID;

    const newSessionID = await forkSession(client, parentSessionID, mapping.worktreePath);
    upsertMapping(db, {
        ...mapping,
        parentSessionID,
        forkedSessionID: newSessionID,
        status: "active",
        updatedAt: new Date().toISOString(),
    });

    return {
        sessionID: newSessionID,
        recreated: true,
    };
}

function createWorktreeTool(client: any) {
    return tool({
        description:
            "Create or reuse a git worktree, fork the current session, and open it in tmux or Ghostty.",
        args: {
            ref: tool.schema
                .string()
                .optional()
                .describe("Branch name, story ID, Shortcut URL, or empty for scratch."),
            base: tool.schema
                .string()
                .optional()
                .describe("Optional base ref when creating a new branch."),
            open: tool.schema
                .boolean()
                .optional()
                .describe("Auto-open tmux/Ghostty for the forked session. Defaults to true."),
        },
        async execute(args, context) {
            const repo = getRepoContext(context.directory);
            if (!repo.context) {
                return `[worktree] error: ${repo.error || "Unable to resolve repository context."}`;
            }

            const { branch, source } = resolveBranchFromRef(args.ref);
            const branchSlug = branchToDirectorySlug(branch);
            mkdirSync(repo.context.projectScopeDir, { recursive: true });

            const preferredPath = join(repo.context.projectScopeDir, branchSlug);

            const db = openDatabase(repo.context.projectScope);
            try {
                const listResult = listGitWorktrees(repo.context.repoRoot);
                if (listResult.error) {
                    return `[worktree] error: ${listResult.error}`;
                }

                const existingBranchWorktree = findWorktreeByBranch(listResult.entries, branch);
                const selectedPath = existingBranchWorktree
                    ? normalizePathWithRealpath(existingBranchWorktree.path)
                    : normalizePath(preferredPath);

                const selectedEntry = findWorktreeByPath(listResult.entries, selectedPath);
                const preferredEntry = findWorktreeByPath(listResult.entries, preferredPath);
                const selectedIsRegistered = Boolean(selectedEntry);
                const preferredIsRegistered = Boolean(preferredEntry);

                if (selectedEntry?.branch && selectedEntry.branch !== branch) {
                    return [
                        "[worktree] error: destination path is already attached to another branch",
                        `path: ${selectedPath}`,
                        `branch: ${selectedEntry.branch}`,
                    ].join("\n");
                }

                if (
                    !existingBranchWorktree
                    && preferredEntry?.branch
                    && preferredEntry.branch !== branch
                ) {
                    return [
                        "[worktree] error: preferred path already belongs to another branch",
                        `path: ${preferredPath}`,
                        `branch: ${preferredEntry.branch}`,
                    ].join("\n");
                }

                if (!selectedIsRegistered && existsSync(selectedPath)) {
                    return [
                        "[worktree] error: destination exists on disk but is not a registered git worktree.",
                        `path: ${selectedPath}`,
                    ].join("\n");
                }

                const mappingForBranch = getMappingByBranch(db, branch);
                let worktreeCreated = false;
                let creationMode = existingBranchWorktree ? "existing-worktree" : "new";
                let baseRefUsed: string | undefined;
                let parentSessionID = context.sessionID;

                if (!selectedIsRegistered && !preferredIsRegistered && !existingBranchWorktree) {
                    const createResult = createWorktree(
                        repo.context.repoRoot,
                        branch,
                        preferredPath,
                        args.base,
                    );

                    if (!createResult.ok) {
                        return `[worktree] error: ${createResult.error || "Failed to create worktree."}`;
                    }

                    worktreeCreated = true;
                    creationMode = createResult.mode || creationMode;
                    baseRefUsed = createResult.baseRef;
                }

                const finalPath = worktreeCreated ? preferredPath : selectedPath;
                if (!worktreeCreated && preferredIsRegistered && !existingBranchWorktree) {
                    creationMode = "existing-path";
                }

                let forkedSessionID: string;
                let recreatedSession = false;

                if (mappingForBranch && normalizePathWithRealpath(mappingForBranch.worktreePath) === normalizePathWithRealpath(finalPath)) {
                    const ensured = await ensureMappingSession(db, mappingForBranch, context, client);
                    const refreshedMapping = getMappingByBranch(db, mappingForBranch.branch);
                    forkedSessionID = ensured.sessionID;
                    recreatedSession = ensured.recreated;
                    parentSessionID = refreshedMapping?.parentSessionID || mappingForBranch.parentSessionID;
                } else {
                    forkedSessionID = await forkSession(client, context.sessionID, finalPath);
                }

                const now = new Date().toISOString();
                const createdAt = mappingForBranch?.createdAt || now;
                upsertMapping(db, {
                    branch,
                    branchSlug,
                    worktreePath: finalPath,
                    parentSessionID,
                    forkedSessionID,
                    status: "active",
                    createdAt,
                    updatedAt: now,
                });

                const shouldOpen = args.open !== false;
                const launch = shouldOpen
                    ? launchSession(finalPath, forkedSessionID, branchSlug)
                    : {
                        opened: false,
                        fallbackCommand: fallbackSessionCommand(finalPath, forkedSessionID),
                    };

                const action = worktreeCreated
                    ? "created"
                    : existingBranchWorktree
                    ? "reused-existing"
                    : "reused";

                const lines = [
                    `[worktree] ${action}`,
                    `scope: ${repo.context.projectScope}`,
                    `branch: ${branch}`,
                    `path: ${finalPath}`,
                    `session: ${forkedSessionID}`,
                    `source: ${source}`,
                    `mode: ${creationMode}`,
                ];

                if (baseRefUsed) {
                    lines.push(`base: ${baseRefUsed}`);
                }

                if (recreatedSession) {
                    lines.push("session_recreated: yes");
                }

                lines.push(...formatLaunchDetails(launch));
                return lines.join("\n");
            } finally {
                db.close();
            }
        },
    });
}

function createWorktreeListTool(client: any) {
    return tool({
        description: "List tracked worktree/session mappings for the current repository scope.",
        args: {
            checkSessions: tool.schema
                .boolean()
                .optional()
                .describe("Verify whether mapped sessions still exist."),
        },
        async execute(args, context) {
            const repo = getRepoContext(context.directory);
            if (!repo.context) {
                return `[worktree] error: ${repo.error || "Unable to resolve repository context."}`;
            }

            const db = openDatabase(repo.context.projectScope);
            try {
                const mappings = getAllMappings(db);
                if (mappings.length === 0) {
                    return `[worktree] no tracked worktrees for scope ${repo.context.projectScope}`;
                }

                const worktrees = listGitWorktrees(repo.context.repoRoot);
                const lines = [
                    `[worktree] tracked entries: ${mappings.length}`,
                    `scope: ${repo.context.projectScope}`,
                ];

                for (const mapping of mappings) {
                    const pathExists = existsSync(mapping.worktreePath);
                    const registered = Boolean(findWorktreeByPath(worktrees.entries, mapping.worktreePath));

                    let sessionStatus = "unchecked";
                    if (args.checkSessions) {
                        sessionStatus = (await sessionExists(client, mapping.forkedSessionID, mapping.worktreePath))
                            ? "ok"
                            : "missing";
                    }

                    const flags = [
                        pathExists ? "on-disk" : "missing-path",
                        registered ? "registered" : "not-registered",
                        `session:${sessionStatus}`,
                    ];

                    lines.push(`- ${mapping.branch}`);
                    lines.push(`  status: ${mapping.status}`);
                    lines.push(`  session: ${mapping.forkedSessionID}`);
                    lines.push(`  path: ${mapping.worktreePath}`);
                    lines.push(`  flags: ${flags.join(",")}`);
                }

                return lines.join("\n");
            } finally {
                db.close();
            }
        },
    });
}

function createWorktreeResumeTool(client: any) {
    return tool({
        description:
            "Resume a tracked worktree session by branch, session ID, or path and open it in tmux/Ghostty.",
        args: {
            ref: tool.schema
                .string()
                .optional()
                .describe("Branch, session ID, path, or omit to infer from current context."),
            open: tool.schema
                .boolean()
                .optional()
                .describe("Auto-open tmux/Ghostty for the session. Defaults to true."),
        },
        async execute(args, context) {
            const repo = getRepoContext(context.directory);
            if (!repo.context) {
                return `[worktree] error: ${repo.error || "Unable to resolve repository context."}`;
            }

            const db = openDatabase(repo.context.projectScope);
            try {
                const mapping = resolveMapping(db, args.ref, context);
                if (!mapping) {
                    return "[worktree] error: no matching tracked worktree found";
                }

                if (!existsSync(mapping.worktreePath)) {
                    updateMappingStatus(db, mapping.branch, "stale");
                    return [
                        "[worktree] error: tracked worktree path is missing",
                        `branch: ${mapping.branch}`,
                        `path: ${mapping.worktreePath}`,
                    ].join("\n");
                }

                const worktreeList = listGitWorktrees(repo.context.repoRoot);
                const registered = Boolean(findWorktreeByPath(worktreeList.entries, mapping.worktreePath));
                if (!registered) {
                    updateMappingStatus(db, mapping.branch, "stale");
                    return [
                        "[worktree] error: tracked path is not a registered git worktree",
                        `branch: ${mapping.branch}`,
                        `path: ${mapping.worktreePath}`,
                    ].join("\n");
                }

                const ensured = await ensureMappingSession(db, mapping, context, client);
                const refreshed = getMappingByBranch(db, mapping.branch);
                if (!refreshed) {
                    return "[worktree] error: failed to refresh mapping after session recovery";
                }

                updateMappingStatus(db, mapping.branch, "active");

                const shouldOpen = args.open !== false;
                const launch = shouldOpen
                    ? launchSession(
                        refreshed.worktreePath,
                        ensured.sessionID,
                        refreshed.branchSlug,
                    )
                    : {
                        opened: false,
                        fallbackCommand: fallbackSessionCommand(
                            refreshed.worktreePath,
                            ensured.sessionID,
                        ),
                    };

                const lines = [
                    "[worktree] resumed",
                    `branch: ${refreshed.branch}`,
                    `path: ${refreshed.worktreePath}`,
                    `session: ${ensured.sessionID}`,
                ];

                if (ensured.recreated) {
                    lines.push("session_recreated: yes");
                }

                lines.push(...formatLaunchDetails(launch));
                return lines.join("\n");
            } finally {
                db.close();
            }
        },
    });
}

function createWorktreeFinishTool() {
    return tool({
        description:
            "Mark a tracked worktree workflow finished. Non-destructive by default; optionally remove worktree path.",
        args: {
            ref: tool.schema
                .string()
                .optional()
                .describe("Branch, session ID, path, or omit to infer from current session."),
            remove: tool.schema
                .boolean()
                .optional()
                .describe("When true, run git worktree remove on the tracked path. Branch is preserved."),
        },
        async execute(args, context) {
            const repo = getRepoContext(context.directory);
            if (!repo.context) {
                return `[worktree] error: ${repo.error || "Unable to resolve repository context."}`;
            }

            const db = openDatabase(repo.context.projectScope);
            try {
                const mapping = resolveMapping(db, args.ref, context);
                if (!mapping) {
                    return "[worktree] error: no matching tracked worktree found";
                }

                let status: MappingRecord["status"] = "archived";
                let removeOutcome = "not-requested";
                let removeError: string | undefined;

                if (args.remove) {
                    const result = runGit(repo.context.repoRoot, "worktree", "remove", mapping.worktreePath);
                    if (result.ok) {
                        status = "removed";
                        removeOutcome = "removed";
                    } else {
                        removeOutcome = "failed";
                        removeError = result.stderr || "git worktree remove failed";
                    }
                }

                updateMappingStatus(db, mapping.branch, status);

                const lines = [
                    "[worktree] finished",
                    `branch: ${mapping.branch}`,
                    `path: ${mapping.worktreePath}`,
                    `status: ${status}`,
                    `remove: ${removeOutcome}`,
                    "branch_deleted: no",
                ];

                if (removeError) {
                    lines.push(`remove_error: ${removeError}`);
                    lines.push(`hint: git worktree remove ${shellQuote(mapping.worktreePath)}`);
                }

                return lines.join("\n");
            } finally {
                db.close();
            }
        },
    });
}

export const WorktreeSessionPlugin: Plugin = async ({ client }) => {
    return {
        tool: {
            wt_create: createWorktreeTool(client),
            wt_list: createWorktreeListTool(client),
            wt_resume: createWorktreeResumeTool(client),
            wt_finish: createWorktreeFinishTool(),
        },
    };
};
