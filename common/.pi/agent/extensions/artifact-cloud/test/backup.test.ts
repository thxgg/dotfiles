import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const testDir = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(testDir, "../../../../../.local/lib/artifact-cloud");
const { ArtifactStore } = await import(`${libDir}/core.mjs`) as any;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artifact-cloud-backup-"));
  const live = join(root, "live");
  const store = await new ArtifactStore(live).open();
  await store.createArtifact({ title: "Portable", content: "<h1>portable</h1>" });
  store.close();
  const backup = join(root, "export");
  const result = spawnSync(process.execPath, [join(libDir, "backup.mjs"), live, backup], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { root, live, backup };
}

test("creates a checksummed portable backup and validates it", async () => {
  const { root, backup } = await fixture();
  try {
    const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
    assert.equal(manifest.format, 2);
    assert.equal(manifest.serviceVersion, 1);
    assert.match(manifest.inventory.database.sha256, /^[0-9a-f]{64}$/);
    const result = spawnSync(process.execPath, [join(libDir, "restore.mjs"), "--validate", backup], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).valid, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects a corrupted blob before restore", async () => {
  const { root, backup } = await fixture();
  try {
    const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
    await writeFile(join(backup, "data", "blobs", manifest.inventory.blobs[0].key), "corrupt");
    const result = spawnSync(process.execPath, [join(libDir, "restore.mjs"), "--validate", backup], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksums do not match/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects unknown manifests and leaves no completed backup on failure", async () => {
  const { root, live, backup } = await fixture();
  try {
    const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
    manifest.format = 999;
    await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest));
    const validate = spawnSync(process.execPath, [join(libDir, "restore.mjs"), "--validate", backup], { encoding: "utf8" });
    assert.notEqual(validate.status, 0);
    const existing = spawnSync(process.execPath, [join(libDir, "backup.mjs"), live, backup], { encoding: "utf8" });
    assert.notEqual(existing.status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
