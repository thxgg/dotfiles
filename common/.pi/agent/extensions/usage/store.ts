import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { fail, ok, UsageFailure, type Account, type AccountState, type Result } from "./domain.ts";
import { parseAccountState, record } from "./protocol.ts";
import type { UsageStore } from "./service.ts";

/** Durable reset coordination and five-minute query cache, outside Stow roots. */
export class FileUsageStore implements UsageStore {
  /** Pass a machine-local state directory, not an extension source directory. */
  constructor(private readonly directory: string) {}

  /** Serialize queries and reset claims for the same account across Pi processes. */
  async withAccount<T>(account: Account, signal: AbortSignal, run: (state: AccountState, save: (next: AccountState) => Promise<Result<void>>, lockSignal: AbortSignal) => Promise<Result<T>>): Promise<Result<T>> {
    if (!/^(codex|anthropic)-[a-f0-9]{64}$/.test(account.key)) return fail(new UsageFailure("storage", "Invalid usage account key."));
    const path = join(this.directory, `${account.key}.json`);
    const compromised = new AbortController();
    const combined = AbortSignal.any([signal, compromised.signal]);
    let release: (() => Promise<void>) | undefined;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      // Keep a separate stable anchor; renaming the atomic state file cannot break the lock.
      const anchor = `${path}.anchor`;
      const handle = await open(anchor, constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.close();
      const deadline = Date.now() + 30_000;
      while (!release) {
        if (combined.aborted) return fail(new UsageFailure("cancelled", "Usage state operation cancelled."));
        try {
          release = await lockfile.lock(anchor, { realpath: false, retries: 0, stale: 120_000, update: 10_000,
            onCompromised: () => compromised.abort() });
        } catch (error) {
          if (record(error)?.code !== "ELOCKED") return fail(new UsageFailure("storage", "Could not acquire the account usage lock."));
          if (Date.now() >= deadline) return fail(new UsageFailure("busy", "Another Pi process is checking or redeeming this account. Try again soon."));
          await sleep(100, undefined, { signal: combined });
        }
      }
      let state: AccountState = {};
      try {
        const bytes = await readFile(path);
        if (bytes.byteLength > 512 * 1024) return fail(new UsageFailure("storage", "Usage state is too large. Redemption is disabled."));
        const raw: unknown = JSON.parse(bytes.toString("utf8"));
        const parsed = parseAccountState(raw, account);
        if (!parsed.ok) return parsed;
        state = parsed.value;
      } catch (error) {
        if (record(error)?.code !== "ENOENT") return fail(new UsageFailure("storage", "Could not read reset idempotency state. Redemption is disabled."));
      }
      const result = await run(state, async next => {
        if (combined.aborted) return fail(new UsageFailure("storage", "Account lock was interrupted. Reset state was not changed."));
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          const file = await open(temporary, "wx", 0o600);
          try {
            await file.writeFile(JSON.stringify({ version: 1, ...next }));
            await file.sync();
          } finally { await file.close(); }
          if (combined.aborted) return fail(new UsageFailure("storage", "Account lock was interrupted before saving reset state."));
          await rename(temporary, path);
          const directory = await open(this.directory, "r");
          try { await directory.sync(); } finally { await directory.close(); }
          return ok(undefined);
        } catch { return fail(new UsageFailure("storage", "Could not save durable reset state. No new reset should be attempted.")); }
        finally { await rm(temporary, { force: true }).catch(() => undefined); }
      }, combined);
      if (compromised.signal.aborted) return fail(new UsageFailure("uncertain", "The account lock was lost. Any pending reset keeps its request ID."));
      return result;
    } catch {
      return fail(new UsageFailure(combined.aborted ? "cancelled" : "storage", "Usage state operation failed or was cancelled."));
    } finally {
      if (release) await release().catch(() => undefined);
    }
  }
}
