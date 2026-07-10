import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface RegistryEntry {
  artifactId: string;
  viewerUrl: string;
  currentVersionId: string;
  updatedAt: string;
}

const registryPath = join(homedir(), ".local", "state", "artifact-cloud", "pi-registry.sqlite3");

export async function getRegistryEntry(realPath: string): Promise<RegistryEntry | undefined> {
  const database = await openRegistry();
  try {
    const row = database.prepare("SELECT artifact_id, viewer_url, current_version_id, updated_at FROM path_mappings WHERE real_path = ?").get(realPath) as Record<string, string> | undefined;
    return row ? {
      artifactId: row.artifact_id!,
      viewerUrl: row.viewer_url!,
      currentVersionId: row.current_version_id!,
      updatedAt: row.updated_at!,
    } : undefined;
  } finally {
    database.close();
  }
}

export async function setRegistryEntry(realPath: string, entry: RegistryEntry): Promise<void> {
  const database = await openRegistry();
  try {
    database.prepare(`
      INSERT INTO path_mappings (real_path, artifact_id, viewer_url, current_version_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(real_path) DO UPDATE SET
        artifact_id = excluded.artifact_id,
        viewer_url = excluded.viewer_url,
        current_version_id = excluded.current_version_id,
        updated_at = excluded.updated_at
    `).run(realPath, entry.artifactId, entry.viewerUrl, entry.currentVersionId, entry.updatedAt);
  } finally {
    database.close();
  }
}

async function openRegistry(): Promise<DatabaseSync> {
  await mkdir(dirname(registryPath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(registryPath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS path_mappings (
      real_path TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      viewer_url TEXT NOT NULL,
      current_version_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  return database;
}
