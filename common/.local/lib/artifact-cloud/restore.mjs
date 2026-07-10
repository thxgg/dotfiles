#!/usr/bin/env node

import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ArtifactStore } from "./core.mjs";
import { validateBackupManifest } from "./backup-format.mjs";

const args = process.argv.slice(2);
const validateOnly = args[0] === "--validate";
if (validateOnly) args.shift();
const [backupInput, dataDirInput] = args;
if (!backupInput || (!validateOnly && !dataDirInput)) {
  console.error("Usage: restore.mjs [--validate] BACKUP_DIR [DATA_DIR]");
  process.exit(2);
}

const backupDir = resolve(backupInput);
const source = join(backupDir, "data");
const manifest = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8"));
const inventory = await validateBackupManifest(backupDir, manifest);

let report;
const sourceStore = await new ArtifactStore(source).open();
try {
  report = await sourceStore.integrityReport();
} finally {
  sourceStore.close();
}
if (!report.ok) throw new Error(`Backup failed integrity validation: ${JSON.stringify(report)}`);
if (validateOnly) {
  console.log(JSON.stringify({ valid: true, backupDir, manifest, inventory, integrity: report }, null, 2));
  process.exit(0);
}

const dataDir = resolve(dataDirInput);
const suffix = `${new Date().toISOString().replaceAll(/[-:.]/g, "")}.${process.pid}`;
const staging = `${dataDir}.restore-staging.${suffix}`;
const previous = `${dataDir}.before-restore.${suffix}`;
await mkdir(dirname(dataDir), { recursive: true, mode: 0o700 });
await rm(staging, { recursive: true, force: true });
await cp(source, staging, { recursive: true, force: false, errorOnExist: true });

let movedPrevious = false;
try {
  try {
    await rename(dataDir, previous);
    movedPrevious = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rename(staging, dataDir);
} catch (error) {
  if (movedPrevious) await rename(previous, dataDir);
  await rm(staging, { recursive: true, force: true });
  throw error;
}

console.log(JSON.stringify({ restoredFrom: backupDir, dataDir, previousData: movedPrevious ? previous : null, integrity: report }, null, 2));
