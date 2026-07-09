import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeFileSystem } from "./fs.ts";

test("writeFileAtomic preserves a Stow-style symlink and updates its target", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-skill-toggle-fs-"));
  try {
    const source = join(root, "source.md");
    const deployed = join(root, "deployed.md");
    await writeFile(source, "before\n", "utf8");
    await symlink(source, deployed);

    const fs = new NodeFileSystem();
    await fs.writeFileAtomic(deployed, "after\n");

    assert.equal(await readFile(source, "utf8"), "after\n");
    assert.equal(await readFile(deployed, "utf8"), "after\n");
    assert.equal((await lstat(deployed)).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
