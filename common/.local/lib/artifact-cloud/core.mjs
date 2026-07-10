import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_LIST_LIMIT = 50;
const MAX_TITLE_LENGTH = 140;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;

export class ArtifactStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dbPath = join(dataDir, "artifacts.sqlite3");
    this.blobsDir = join(dataDir, "blobs");
    this.tmpDir = join(dataDir, "tmp");
    this.db = undefined;
    this.writeQueue = Promise.resolve();
  }

  async open() {
    await mkdir(this.blobsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(SCHEMA);
    const versionColumns = this.db.prepare("PRAGMA table_info(artifact_versions)").all();
    if (!versionColumns.some((column) => column.name === "runtime_mode")) {
      this.db.exec("ALTER TABLE artifact_versions ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'static' CHECK (runtime_mode IN ('static', 'interactive'))");
    }
    return this;
  }

  close() {
    this.db?.close();
    this.db = undefined;
  }

  async createArtifact(input) {
    return this.withWriteLock(async () => {
      const normalized = normalizeArtifactInput(input);
      assertArtifactHtml(normalized.content, normalized.runtimeMode);
      const now = new Date().toISOString();
      const artifactId = randomUUID();
      const versionId = randomUUID();
      if (normalized.slug && this.getArtifact(normalized.slug)) {
        const error = new Error(`Artifact slug "${normalized.slug}" already exists. Update that artifact or choose another slug.`);
        error.code = "SLUG_CONFLICT";
        throw error;
      }
      const slug = normalized.slug ?? this.uniqueSlug(normalized.title);
      const blob = await this.writeBlob(normalized.content);

      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.prepare(`
          INSERT INTO artifacts (id, slug, title, description, tags_json, current_version_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(artifactId, slug, normalized.title, normalized.description, JSON.stringify(normalized.tags), versionId, now, now);
        this.db.prepare(`
          INSERT INTO artifact_versions
            (id, artifact_id, sequence, sha256, blob_key, media_type, byte_size, source_name, provenance_json, runtime_mode, created_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(versionId, artifactId, blob.sha256, blob.blobKey, normalized.mediaType, blob.byteSize, normalized.sourceName, JSON.stringify(normalized.provenance), normalized.runtimeMode, now);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return this.getArtifact(artifactId);
    });
  }

  async appendVersion(artifactId, input, options = {}) {
    return this.withWriteLock(async () => {
      const normalized = normalizeVersionInput(input);
      assertArtifactHtml(normalized.content, normalized.runtimeMode);
      const blob = await this.writeBlob(normalized.content);
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const artifact = this.getArtifact(artifactId);
        if (!artifact) {
          this.db.exec("ROLLBACK");
          return undefined;
        }
        if (options.expectedCurrentVersionId && options.expectedCurrentVersionId !== artifact.currentVersion.id) {
          const error = new Error("The artifact changed since it was read.");
          error.code = "VERSION_CONFLICT";
          throw error;
        }
        if (blob.sha256 === artifact.currentVersion.sha256) {
          this.db.exec("ROLLBACK");
          return { ...artifact, unchanged: true };
        }
        const now = new Date().toISOString();
        const versionId = randomUUID();
        const row = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM artifact_versions WHERE artifact_id = ?").get(artifactId);
        this.db.prepare(`
          INSERT INTO artifact_versions
            (id, artifact_id, sequence, sha256, blob_key, media_type, byte_size, source_name, provenance_json, runtime_mode, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(versionId, artifactId, row.next_sequence, blob.sha256, blob.blobKey, normalized.mediaType, blob.byteSize, normalized.sourceName, JSON.stringify(normalized.provenance), normalized.runtimeMode, now);
        this.db.prepare("UPDATE artifacts SET current_version_id = ?, updated_at = ? WHERE id = ? AND current_version_id = ?")
          .run(versionId, now, artifactId, artifact.currentVersion.id);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return this.getArtifact(artifactId);
    });
  }

  async updateArtifact(idOrSlug, patch) {
    return this.withWriteLock(async () => {
      const artifact = this.getArtifact(idOrSlug);
      if (!artifact) return undefined;
      const normalized = normalizeArtifactPatch(patch, artifact);
      if (normalized.slug !== artifact.slug) {
        const conflicting = this.getArtifact(normalized.slug);
        if (conflicting && conflicting.id !== artifact.id) {
          const error = new Error(`Artifact slug "${normalized.slug}" already exists. Choose another slug.`);
          error.code = "SLUG_CONFLICT";
          throw error;
        }
      }
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE artifacts SET slug = ?, title = ?, description = ?, tags_json = ?, archived_at = ?, updated_at = ? WHERE id = ?
      `).run(normalized.slug, normalized.title, normalized.description, JSON.stringify(normalized.tags), normalized.archivedAt, now, artifact.id);
      return this.getArtifact(artifact.id);
    });
  }

  async deleteArtifact(idOrSlug) {
    return this.withWriteLock(async () => {
      const artifact = this.getArtifact(idOrSlug);
      if (!artifact) return undefined;
      if (!artifact.archivedAt) {
        const error = new Error("Archive the artifact before permanently deleting it.");
        error.code = "ARTIFACT_NOT_ARCHIVED";
        throw error;
      }
      const blobKeys = this.db.prepare("SELECT DISTINCT blob_key FROM artifact_versions WHERE artifact_id = ?").all(artifact.id).map((row) => row.blob_key);
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.prepare("DELETE FROM artifact_versions WHERE artifact_id = ?").run(artifact.id);
        this.db.prepare("DELETE FROM artifacts WHERE id = ?").run(artifact.id);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      for (const blobKey of blobKeys) {
        const referenced = this.db.prepare("SELECT 1 FROM artifact_versions WHERE blob_key = ? LIMIT 1").get(blobKey);
        if (!referenced) await rm(join(this.blobsDir, blobKey), { force: true });
      }
      return artifact;
    });
  }

  getArtifact(idOrSlug) {
    const row = this.db.prepare(`
      SELECT a.*, v.id AS version_id, v.sequence, v.sha256, v.blob_key, v.media_type,
             v.byte_size, v.source_name, v.provenance_json, v.runtime_mode, v.created_at AS version_created_at
      FROM artifacts a
      JOIN artifact_versions v ON v.id = a.current_version_id
      WHERE a.id = ? OR a.slug = ?
      LIMIT 1
    `).get(idOrSlug, idOrSlug);
    return row ? mapArtifactRow(row) : undefined;
  }

  getVersion(versionId) {
    const row = this.db.prepare(`
      SELECT v.*, a.slug, a.title, a.archived_at
      FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
      WHERE v.id = ?
    `).get(versionId);
    return row ? mapVersionRow(row) : undefined;
  }

  listVersions(artifactId) {
    return this.db.prepare(`
      SELECT v.*, a.slug, a.title, a.archived_at
      FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
      WHERE v.artifact_id = ? ORDER BY v.sequence DESC
    `).all(artifactId).map(mapVersionRow);
  }

  listArtifacts({ search, tag, sort = "updated", limit = DEFAULT_LIST_LIMIT, includeArchived = false } = {}) {
    const clauses = [];
    const values = [];
    if (!includeArchived) clauses.push("a.archived_at IS NULL");
    if (search) {
      clauses.push("(a.title LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\' OR a.slug LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLike(search)}%`;
      values.push(pattern, pattern, pattern);
    }
    if (tag) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(a.tags_json) WHERE value = ?)");
      values.push(normalizeTag(tag));
    }
    values.push(Math.max(1, Math.min(100, Number(limit) || DEFAULT_LIST_LIMIT)));
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const orderBy = {
      updated: "a.updated_at DESC, a.title COLLATE NOCASE ASC",
      created: "a.created_at DESC, a.title COLLATE NOCASE ASC",
      title: "a.title COLLATE NOCASE ASC, a.updated_at DESC",
      oldest: "a.updated_at ASC, a.title COLLATE NOCASE ASC",
    }[sort] ?? "a.updated_at DESC, a.title COLLATE NOCASE ASC";
    return this.db.prepare(`
      SELECT a.*, v.id AS version_id, v.sequence, v.sha256, v.blob_key, v.media_type,
             v.byte_size, v.source_name, v.provenance_json, v.runtime_mode, v.created_at AS version_created_at
      FROM artifacts a JOIN artifact_versions v ON v.id = a.current_version_id
      ${where} ORDER BY ${orderBy} LIMIT ?
    `).all(...values).map(mapArtifactRow);
  }

  async readVersionContent(version) {
    return readFile(join(this.blobsDir, version.blobKey));
  }

  async integrityReport() {
    const databaseIntegrity = this.db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
    const references = this.db.prepare("SELECT blob_key, sha256, byte_size FROM artifact_versions ORDER BY blob_key").all();
    const referencedKeys = new Set(references.map((row) => row.blob_key));
    const missing = [];
    const corrupt = [];
    for (const reference of references) {
      const path = join(this.blobsDir, reference.blob_key);
      try {
        const content = await readFile(path);
        const sha256 = createHash("sha256").update(content).digest("hex");
        if (content.length !== reference.byte_size || sha256 !== reference.sha256) corrupt.push(reference.blob_key);
      } catch (error) {
        if (error.code === "ENOENT") missing.push(reference.blob_key);
        else throw error;
      }
    }
    const storedKeys = await listBlobKeys(this.blobsDir);
    const orphaned = storedKeys.filter((key) => !referencedKeys.has(key));
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM artifacts) AS artifacts,
        (SELECT COUNT(*) FROM artifacts WHERE archived_at IS NOT NULL) AS archived,
        (SELECT COUNT(*) FROM artifact_versions) AS versions,
        (SELECT COALESCE(SUM(byte_size), 0) FROM artifact_versions) AS referenced_bytes
    `).get();
    let storedBytes = 0;
    for (const key of storedKeys) storedBytes += (await stat(join(this.blobsDir, key))).size;
    return {
      ok: databaseIntegrity.length === 1 && databaseIntegrity[0] === "ok" && missing.length === 0 && corrupt.length === 0,
      databaseIntegrity,
      artifacts: counts.artifacts,
      archivedArtifacts: counts.archived,
      versions: counts.versions,
      referencedBytes: counts.referenced_bytes,
      storedBlobs: storedKeys.length,
      storedBytes,
      missingBlobs: missing,
      corruptBlobs: corrupt,
      orphanedBlobs: orphaned,
    };
  }

  async backup(destinationDir) {
    await mkdir(destinationDir, { recursive: true, mode: 0o700 });
    const backupPath = join(destinationDir, "artifacts.sqlite3");
    await this.dbBackup(backupPath);
    return { database: backupPath, blobs: this.blobsDir };
  }

  async dbBackup(destination) {
    const { backup } = await import("node:sqlite");
    await backup(this.db, destination);
  }

  uniqueSlug(value, excludingId) {
    const base = slugify(value);
    let candidate = base;
    let suffix = 2;
    const statement = excludingId
      ? this.db.prepare("SELECT 1 FROM artifacts WHERE slug = ? AND id != ?")
      : this.db.prepare("SELECT 1 FROM artifacts WHERE slug = ?");
    while (excludingId ? statement.get(candidate, excludingId) : statement.get(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async withWriteLock(operation) {
    const previous = this.writeQueue;
    let release;
    this.writeQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async writeBlob(content) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (bytes.length === 0) throw new Error("Artifact content must not be empty.");
    if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`Artifact content exceeds ${MAX_ARTIFACT_BYTES} bytes.`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const blobKey = `${sha256.slice(0, 2)}/${sha256}.html`;
    const destination = join(this.blobsDir, blobKey);
    try {
      await stat(destination);
      return { sha256, blobKey, byteSize: bytes.length };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = join(this.tmpDir, `${randomUUID()}.tmp`);
    await writeFile(temporary, bytes, { mode: 0o600 });
    try {
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      if (error.code !== "EEXIST") throw error;
    }
    return { sha256, blobKey, byteSize: bytes.length };
  }
}

export function normalizeArtifactInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an artifact object.");
  const content = normalizeContent(input.content);
  return {
    title: normalizeText(input.title, "title", MAX_TITLE_LENGTH, true),
    description: normalizeText(input.description, "description", MAX_DESCRIPTION_LENGTH, false),
    slug: input.slug === undefined ? undefined : normalizeSlug(input.slug),
    tags: normalizeTags(input.tags),
    content,
    mediaType: normalizeMediaType(input.mediaType),
    sourceName: normalizeSourceName(input.sourceName),
    provenance: normalizeProvenance(input.provenance),
    runtimeMode: normalizeRuntimeMode(input.runtimeMode),
  };
}

export function normalizeVersionInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a version object.");
  return {
    content: normalizeContent(input.content),
    mediaType: normalizeMediaType(input.mediaType),
    sourceName: normalizeSourceName(input.sourceName),
    provenance: normalizeProvenance(input.provenance),
    runtimeMode: normalizeRuntimeMode(input.runtimeMode),
  };
}

export function validateStaticArtifactHtml(content) {
  const html = Buffer.isBuffer(content) ? content.toString("utf8") : content;
  const errors = [];
  if (Buffer.byteLength(html, "utf8") > MAX_ARTIFACT_BYTES) errors.push(`Source exceeds ${MAX_ARTIFACT_BYTES} bytes.`);
  if (/<script\b/i.test(html)) errors.push("Scripts are disabled.");
  if (/\son[a-z]+\s*=/i.test(html)) errors.push("Inline event handlers are disabled.");
  if (/<(?:iframe|object|embed)\b/i.test(html)) errors.push("Embedded browsing and plugin content is disabled.");
  if (/<form\b/i.test(html)) errors.push("Forms are disabled.");
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/i.test(html)) errors.push("Meta refresh navigation is disabled.");
  for (const reference of staticResourceReferences(html)) {
    if (!isEmbeddedStaticReference(reference)) errors.push(`External or relative resource is not embedded: ${summarizeReference(reference)}.`);
  }
  const css = extractCss(html);
  if (/@import\b/i.test(css)) errors.push("CSS @import is disabled.");
  for (const match of css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!isEmbeddedStaticReference(match[2])) errors.push(`CSS resource is not embedded: ${summarizeReference(match[2])}.`);
  }
  return [...new Set(errors)];
}

export function validateInteractiveArtifactHtml(content) {
  const html = Buffer.isBuffer(content) ? content.toString("utf8") : content;
  const errors = validateStaticArtifactHtml(html);
  for (const link of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    if (!isEmbeddedStaticReference(link[2])) errors.push(`Interactive artifact links must stay within the document: ${summarizeReference(link[2])}.`);
  }
  return [...new Set(errors)];
}

export function assertArtifactHtml(content, runtimeMode = "static") {
  const errors = runtimeMode === "interactive" ? validateInteractiveArtifactHtml(content) : validateStaticArtifactHtml(content);
  if (!errors.length) return;
  const error = new Error(`Artifact validation failed: ${errors.join(" ")}`);
  error.code = "VALIDATION_FAILED";
  throw error;
}

export function tokenMatches(expected, received) {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || `artifact-${randomUUID().slice(0, 8)}`;
}

function normalizeArtifactPatch(patch, existing) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Expected a patch object.");
  return {
    title: patch.title === undefined ? existing.title : normalizeText(patch.title, "title", MAX_TITLE_LENGTH, true),
    description: patch.description === undefined ? existing.description : normalizeText(patch.description, "description", MAX_DESCRIPTION_LENGTH, false),
    slug: patch.slug === undefined ? existing.slug : normalizeSlug(patch.slug),
    tags: patch.tags === undefined ? existing.tags : normalizeTags(patch.tags),
    archivedAt: patch.archived === undefined ? existing.archivedAt : patch.archived ? new Date().toISOString() : null,
  };
}

function normalizeContent(value) {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) throw new Error("content must be a string or byte buffer.");
  return value;
}

function normalizeText(value, name, maximum, required) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${name} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${name} is required.`);
  if (normalized.length > maximum) throw new Error(`${name} must be ${maximum} characters or fewer.`);
  return normalized;
}

function normalizeSlug(value) {
  if (typeof value !== "string") throw new Error("slug must be a string.");
  const normalized = slugify(value);
  if (!normalized) throw new Error("slug is invalid.");
  return normalized;
}

function normalizeTags(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("tags must be an array.");
  const tags = [...new Set(value.map(normalizeTag).filter(Boolean))];
  if (tags.length > MAX_TAGS) throw new Error(`tags must contain at most ${MAX_TAGS} unique entries.`);
  return tags;
}

function normalizeTag(value) {
  if (typeof value !== "string") throw new Error("each tag must be a string.");
  const tag = slugify(value).slice(0, MAX_TAG_LENGTH);
  if (!tag) throw new Error("tag is invalid.");
  return tag;
}

function normalizeMediaType(value) {
  if (value === undefined || value === "text/html") return "text/html";
  throw new Error("Only text/html artifacts are supported in the MVP.");
}

function normalizeRuntimeMode(value) {
  if (value === undefined || value === "static") return "static";
  if (value === "interactive") return "interactive";
  throw new Error("runtimeMode must be static or interactive.");
}

function normalizeSourceName(value) {
  if (value === undefined || value === null) return "artifact.html";
  if (typeof value !== "string") throw new Error("sourceName must be a string.");
  return value.replaceAll("\\", "/").split("/").pop().slice(0, 180) || "artifact.html";
}

function normalizeProvenance(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("provenance must be an object.");
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 4096) throw new Error("provenance exceeds 4096 bytes.");
  return JSON.parse(json);
}

function mapArtifactRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    tags: safeJson(row.tags_json, []),
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    currentVersion: {
      id: row.version_id,
      artifactId: row.id,
      sequence: row.sequence,
      sha256: row.sha256,
      blobKey: row.blob_key,
      mediaType: row.media_type,
      byteSize: row.byte_size,
      sourceName: row.source_name,
      provenance: safeJson(row.provenance_json, {}),
      runtimeMode: row.runtime_mode ?? "static",
      createdAt: row.version_created_at,
    },
  };
}

function mapVersionRow(row) {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    sequence: row.sequence,
    sha256: row.sha256,
    blobKey: row.blob_key,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    sourceName: row.source_name,
    provenance: safeJson(row.provenance_json, {}),
    runtimeMode: row.runtime_mode ?? "static",
    createdAt: row.created_at,
    artifactSlug: row.slug,
    artifactTitle: row.title,
    archivedAt: row.archived_at ?? null,
  };
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function listBlobKeys(root) {
  const keys = [];
  let prefixes;
  try { prefixes = await readdir(root, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT") return keys;
    throw error;
  }
  for (const prefix of prefixes) {
    if (!prefix.isDirectory()) continue;
    for (const entry of await readdir(join(root, prefix.name), { withFileTypes: true })) {
      if (entry.isFile()) keys.push(`${prefix.name}/${entry.name}`);
    }
  }
  return keys.sort();
}

function staticResourceReferences(html) {
  const references = [];
  for (const match of html.matchAll(/<(img|source|video|audio|track|link)\b([^>]*)>/gi)) {
    const element = match[1].toLowerCase();
    const attributes = match[2] ?? "";
    if (element === "link" && !/\brel\s*=\s*["'][^"']*(?:stylesheet|icon|preload|modulepreload)[^"']*["']/i.test(attributes)) continue;
    for (const attribute of ["src", "srcset", "poster", "href"]) {
      const value = new RegExp(`\\b${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attributes)?.[2];
      if (!value) continue;
      if (attribute === "srcset") references.push(...value.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean));
      else references.push(value);
    }
  }
  return references;
}

function extractCss(html) {
  const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
  const inline = [...html.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map((match) => match[2]);
  return [...blocks, ...inline].join("\n");
}

function isEmbeddedStaticReference(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "" || normalized.startsWith("data:") || normalized.startsWith("#");
}

function summarizeReference(value) {
  const compact = String(value).replace(/\s+/g, " ").trim();
  return JSON.stringify(compact.length > 80 ? `${compact.slice(0, 77)}…` : compact);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  current_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS artifacts_updated ON artifacts (updated_at DESC);
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  sequence INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  blob_key TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type = 'text/html'),
  byte_size INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  runtime_mode TEXT NOT NULL DEFAULT 'static' CHECK (runtime_mode IN ('static', 'interactive')),
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, sequence)
) STRICT;
CREATE INDEX IF NOT EXISTS versions_artifact_sequence ON artifact_versions (artifact_id, sequence DESC);
`;
