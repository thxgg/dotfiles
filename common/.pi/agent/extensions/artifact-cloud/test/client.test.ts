import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShellAssignments, resolveArtifactIdentifier, resolveLocalPath } from "../client.ts";
import { localViewerUrl } from "../index.ts";

test("reads simple shell assignments without executing the file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artifact-cloud-client-"));
  const file = join(directory, "secrets");
  try {
    await writeFile(file, `# comment\nARTIFACT_CLOUD_PUBLISH_TOKEN=abc123\nARTIFACT_CLOUD_BASE_URL=https://example.test\n`);
    const values = await readShellAssignments(file);
    assert.equal(values.ARTIFACT_CLOUD_PUBLISH_TOKEN, "abc123");
    assert.equal(values.ARTIFACT_CLOUD_BASE_URL, "https://example.test");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects executable config syntax", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artifact-cloud-client-"));
  const file = join(directory, "config");
  try {
    await writeFile(file, "ARTIFACT_CLOUD_PUBLISH_TOKEN=$(echo danger)\n");
    await assert.rejects(readShellAssignments(file), /must be literal/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolves relative local paths", () => {
  assert.equal(resolveLocalPath("/tmp/project", "docs/report.html"), "/tmp/project/docs/report.html");
});

test("maps canonical viewer URLs to the local API origin for opening", () => {
  assert.equal(localViewerUrl({ apiUrl: "http://127.0.0.1:3000", viewerBaseUrl: "https://host.test", publishToken: "secret" }, "https://host.test/a/report"), "http://127.0.0.1:3000/a/report");
});

test("resolves artifact IDs, slugs, and canonical URLs", () => {
  assert.equal(resolveArtifactIdentifier("daily-report"), "daily-report");
  assert.equal(resolveArtifactIdentifier("https://host.test/a/daily-report"), "daily-report");
  assert.equal(resolveArtifactIdentifier("https://host.test/v1/artifacts/123e4567-e89b-12d3-a456-426614174000"), "123e4567-e89b-12d3-a456-426614174000");
  assert.throws(() => resolveArtifactIdentifier("https://host.test/v/version-id"), /canonical/);
});
