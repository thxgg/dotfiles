import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const BACKUP_FORMAT = 2;
export const SERVICE_VERSION = 1;
export const BLOB_KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{64}\.html$/;

export async function fileSha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function backupInventory(dataDir) {
  const databasePath = join(dataDir, "artifacts.sqlite3");
  const blobs = [];
  for (const prefix of await safeReadDir(join(dataDir, "blobs"))) {
    for (const name of await safeReadDir(join(dataDir, "blobs", prefix))) {
      const key = `${prefix}/${name}`;
      if (!BLOB_KEY_PATTERN.test(key)) throw new Error(`Unsafe or unsupported blob key: ${key}`);
      const path = join(dataDir, "blobs", key);
      const details = await stat(path);
      if (!details.isFile()) throw new Error(`Blob is not a regular file: ${key}`);
      blobs.push({ key, bytes: details.size, sha256: await fileSha256(path) });
    }
  }
  blobs.sort((a, b) => a.key.localeCompare(b.key));
  const database = await stat(databasePath);
  return {
    database: { bytes: database.size, sha256: await fileSha256(databasePath) },
    blobs,
  };
}

export async function validateBackupManifest(backupDir, manifest) {
  if (!manifest || manifest.service !== "artifact-cloud" || manifest.format !== BACKUP_FORMAT) {
    throw new Error("Unsupported artifact-cloud backup manifest.");
  }
  if (manifest.serviceVersion !== SERVICE_VERSION || !manifest.inventory) {
    throw new Error("Incompatible artifact-cloud backup manifest.");
  }
  const actual = await backupInventory(join(backupDir, "data"));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.inventory)) {
    throw new Error("Backup file inventory or checksums do not match the manifest.");
  }
  return actual;
}

async function safeReadDir(path) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
