import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_STATE, loadState, persistEnabled } from "../config.ts";

test("experimental compaction is disabled by default", () => {
  assert.deepEqual(DEFAULT_STATE, { enabled: false });
});

test("global toggle state persists privately and recovers safely", async () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "experimental-compaction-state-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    assert.deepEqual(await loadState(), { enabled: false });
    const saved = await persistEnabled(true);
    assert.equal(saved.enabled, true);
    assert.equal((await loadState()).enabled, true);
    const target = path.join(agentDir, ".cache", "experimental-compaction", "state.json");
    assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    await fs.writeFile(target, "invalid json");
    assert.deepEqual(await loadState(), { enabled: false });
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await fs.rm(agentDir, { recursive: true, force: true });
  }
});
