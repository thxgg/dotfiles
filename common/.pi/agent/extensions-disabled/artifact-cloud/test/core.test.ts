import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const coreUrl = pathToFileURL(resolve(testDir, "../../../../../.local/lib/artifact-cloud/core.mjs")).href;
const { ArtifactStore, slugify, tokenMatches, validateInteractiveArtifactHtml, validateStaticArtifactHtml } = await import(coreUrl) as any;

test("creates an artifact and appends immutable versions", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const created = await store.createArtifact({
      title: "Deployment Report",
      description: "A report",
      tags: ["Deploy", "Report"],
      content: "<h1>v1</h1>",
      sourceName: "report.html",
    });
    assert.equal(created.slug, "deployment-report");
    assert.equal(created.currentVersion.sequence, 1);
    assert.deepEqual(created.tags, ["deploy", "report"]);
    assert.equal((await store.readVersionContent(created.currentVersion)).toString(), "<h1>v1</h1>");

    const updated = await store.appendVersion(created.id, { content: "<h1>v2</h1>" }, { expectedCurrentVersionId: created.currentVersion.id });
    assert.equal(updated.currentVersion.sequence, 2);
    assert.equal(updated.slug, created.slug);
    assert.equal(store.listVersions(created.id).length, 2);
    assert.equal(store.getVersion(created.currentVersion.id).sequence, 1);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("deduplicates unchanged current content", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const created = await store.createArtifact({ title: "Same", content: "<p>same</p>" });
    const result = await store.appendVersion(created.id, { content: "<p>same</p>" }, { expectedCurrentVersionId: created.currentVersion.id });
    assert.equal(result.unchanged, true);
    assert.equal(store.listVersions(created.id).length, 1);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("serializes concurrent updates so one stale writer is rejected", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const created = await store.createArtifact({ title: "Concurrent", content: "<p>v1</p>" });
    const results = await Promise.allSettled([
      store.appendVersion(created.id, { content: "<p>v2-a</p>" }, { expectedCurrentVersionId: created.currentVersion.id }),
      store.appendVersion(created.id, { content: "<p>v2-b</p>" }, { expectedCurrentVersionId: created.currentVersion.id }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result: any) => result.status === "rejected" && result.reason.code === "VERSION_CONFLICT").length, 1);
    assert.equal(store.listVersions(created.id).length, 2);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("serializes concurrent creates and allocates unique slugs", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const artifacts = await Promise.all([
      store.createArtifact({ title: "Same title", content: "<p>one</p>" }),
      store.createArtifact({ title: "Same title", content: "<p>two</p>" }),
    ]);
    assert.deepEqual(artifacts.map((artifact: any) => artifact.slug).sort(), ["same-title", "same-title-2"]);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("rejects duplicate explicit slugs with a recovery hint", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    await store.createArtifact({ title: "First", slug: "stable-report", content: "<p>one</p>" });
    await assert.rejects(
      store.createArtifact({ title: "Second", slug: "stable-report", content: "<p>two</p>" }),
      (error: any) => error.code === "SLUG_CONFLICT" && /Update that artifact/.test(error.message),
    );
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("rejects stale expected versions", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const created = await store.createArtifact({ title: "Conflict", content: "<p>v1</p>" });
    await assert.rejects(
      store.appendVersion(created.id, { content: "<p>v2</p>" }, { expectedCurrentVersionId: "stale" }),
      (error: any) => error.code === "VERSION_CONFLICT",
    );
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("escapes LIKE wildcards in search and archives without deletion", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const percent = await store.createArtifact({ title: "100% Ready", content: "<p>ok</p>" });
    await store.createArtifact({ title: "Ordinary", content: "<p>ok</p>" });
    assert.deepEqual(store.listArtifacts({ search: "%" }).map((item: any) => item.id), [percent.id]);
    await store.updateArtifact(percent.id, { archived: true });
    assert.equal(store.listArtifacts().some((item: any) => item.id === percent.id), false);
    assert.ok(store.getArtifact(percent.id));
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("sorts artifact listings by supported deterministic orders", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    await store.createArtifact({ title: "Zulu", content: "<p>z</p>" });
    await store.createArtifact({ title: "Alpha", content: "<p>a</p>" });
    assert.deepEqual(store.listArtifacts({ sort: "title" }).map((item: any) => item.title), ["Alpha", "Zulu"]);
    assert.deepEqual(store.listArtifacts({ sort: "created" }).map((item: any) => item.title), ["Alpha", "Zulu"]);
    assert.deepEqual(store.listArtifacts({ sort: "unsupported" }).map((item: any) => item.title), ["Alpha", "Zulu"]);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("permanently deletes only archived artifacts and unreferenced blobs", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const first = await store.createArtifact({ title: "First", content: "<p>shared</p>" });
    const second = await store.createArtifact({ title: "Second", content: "<p>shared</p>" });
    await assert.rejects(store.deleteArtifact(first.id), (error: any) => error.code === "ARTIFACT_NOT_ARCHIVED");
    await store.updateArtifact(first.id, { archived: true });
    await store.deleteArtifact(first.id);
    assert.equal(store.getArtifact(first.id), undefined);
    assert.equal((await store.readVersionContent(second.currentVersion)).toString(), "<p>shared</p>");

    await store.updateArtifact(second.id, { archived: true });
    await store.deleteArtifact(second.slug);
    await assert.rejects(readFile(join(dataDir, "blobs", second.currentVersion.blobKey)), { code: "ENOENT" });
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("rejects unsafe content at the storage boundary", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    await assert.rejects(
      store.createArtifact({ title: "Unsafe", content: "<script>alert(1)</script>" }),
      (error: any) => error.code === "VALIDATION_FAILED",
    );
    const safe = await store.createArtifact({ title: "Safe", content: "<!doctype html><style>body{background:url(data:image/png;base64,AA==)}</style><main>ok</main>" });
    await assert.rejects(
      store.appendVersion(safe.id, { content: '<img src="asset.png" alt="">' }, { expectedCurrentVersionId: safe.currentVersion.id }),
      (error: any) => error.code === "VALIDATION_FAILED",
    );
    assert.deepEqual(validateStaticArtifactHtml('<a href="https://example.test">citation</a>'), []);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("stores runtime policy per immutable version", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const created = await store.createArtifact({ title: "Interactive", runtimeMode: "interactive", content: "<main><output id='count'>0</output><button data-artifact-increment='count'>Count</button></main>" });
    assert.equal(created.currentVersion.runtimeMode, "interactive");
    const updated = await store.appendVersion(created.id, { runtimeMode: "static", content: "<main>Static again</main>" }, { expectedCurrentVersionId: created.currentVersion.id });
    assert.equal(updated.currentVersion.runtimeMode, "static");
    assert.deepEqual(store.listVersions(created.id).map((version: any) => version.runtimeMode), ["static", "interactive"]);
    assert.deepEqual(validateInteractiveArtifactHtml("<button data-artifact-toggle='panel'>Toggle</button>"), []);
    assert.deepEqual(validateInteractiveArtifactHtml("<script>ok()</script>"), ["Scripts are disabled."]);
    assert.deepEqual(validateInteractiveArtifactHtml("<form></form>"), ["Forms are disabled."]);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("reports database, blob, hash, and orphan integrity", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const created = await store.createArtifact({ title: "Integrity", content: "<p>good</p>" });
    let report = await store.integrityReport();
    assert.equal(report.ok, true);
    assert.equal(report.artifacts, 1);
    assert.equal(report.versions, 1);
    assert.deepEqual(report.missingBlobs, []);

    await mkdir(join(dataDir, "blobs", "ff"), { recursive: true });
    await writeFile(join(dataDir, "blobs", "ff", "orphan.html"), "unused");
    report = await store.integrityReport();
    assert.deepEqual(report.orphanedBlobs, ["ff/orphan.html"]);

    await writeFile(join(dataDir, "blobs", created.currentVersion.blobKey), "corrupt");
    report = await store.integrityReport();
    assert.equal(report.ok, false);
    assert.deepEqual(report.corruptBlobs, [created.currentVersion.blobKey]);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("content-addresses blobs and produces portable files", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "artifact-cloud-core-"));
  const store = await new ArtifactStore(dataDir).open();
  try {
    const created = await store.createArtifact({ title: "Blob", content: "<p>blob</p>" });
    const blob = await readFile(join(dataDir, "blobs", created.currentVersion.blobKey), "utf8");
    assert.equal(blob, "<p>blob</p>");
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("utility functions normalize slugs and compare tokens", () => {
  assert.equal(slugify("Crème & Deploy!"), "creme-deploy");
  assert.equal(tokenMatches("secret", "secret"), true);
  assert.equal(tokenMatches("secret", "wrong"), false);
  assert.equal(tokenMatches("", ""), false);
});
