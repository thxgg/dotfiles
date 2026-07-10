#!/usr/bin/env node

import { backup, DatabaseSync } from "node:sqlite";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { ArtifactStore } from "./core.mjs";
import { BACKUP_FORMAT, SERVICE_VERSION, backupInventory } from "./backup-format.mjs";

const [dataDirInput, destinationInput] = process.argv.slice(2);
if (!dataDirInput || !destinationInput) {
  console.error("Usage: backup.mjs DATA_DIR DESTINATION_DIR");
  process.exit(2);
}

const dataDir = resolve(dataDirInput);
const destination = resolve(destinationInput);
const staging = join(dirname(destination), `.${basename(destination)}.incomplete.${process.pid}`);
const destinationData = join(staging, "data");
const destinationDatabase = join(destinationData, "artifacts.sqlite3");

await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
await rm(staging, { recursive: true, force: true });
try {
  await mkdir(destinationData, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(join(dataDir, "artifacts.sqlite3"), { readOnly: true });
  try {
    await backup(database, destinationDatabase);
  } finally {
    database.close();
  }

  await cp(join(dataDir, "blobs"), join(destinationData, "blobs"), {
    recursive: true,
    force: false,
    errorOnExist: false,
  });

  const store = await new ArtifactStore(destinationData).open();
  let integrity;
  try {
    integrity = await store.integrityReport();
  } finally {
    store.close();
  }
  if (!integrity.ok) throw new Error(`Backup failed integrity validation: ${JSON.stringify(integrity)}`);

  const manifest = {
    format: BACKUP_FORMAT,
    service: "artifact-cloud",
    serviceVersion: SERVICE_VERSION,
    createdAt: new Date().toISOString(),
    sourcePlatform: process.platform,
    nodeVersion: process.version,
    integrity,
    inventory: await backupInventory(destinationData),
  };
  await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(staging, destination);
  console.log(destination);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
