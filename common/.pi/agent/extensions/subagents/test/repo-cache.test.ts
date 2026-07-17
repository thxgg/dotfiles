import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRepoUrl, validateRef, withRepoLock, type RepoCacheResult } from "../repo-cache.ts";

test("normalizeRepoUrl accepts public HTTPS GitHub URLs", () => {
  assert.deepEqual(normalizeRepoUrl("https://github.com/earendil-works/pi-mono.git"), {
    normalizedUrl: "https://github.com/earendil-works/pi-mono",
    cloneUrl: "https://github.com/earendil-works/pi-mono.git",
    host: "github.com",
    pathname: "/earendil-works/pi-mono",
  });
});

test("normalizeRepoUrl rejects credential and private URLs", () => {
  assert.throws(() => normalizeRepoUrl("https://token@github.com/org/repo"), /credentials/);
  assert.throws(() => normalizeRepoUrl("http://github.com/org/repo"), /HTTPS/);
  assert.throws(() => normalizeRepoUrl("https://localhost/org/repo"), /localhost|private/);
  assert.throws(() => normalizeRepoUrl("https://192.168.1.10/org/repo"), /private/);
});

test("validateRef permits simple branches tags and commits", () => {
  assert.equal(validateRef("main"), "main");
  assert.equal(validateRef("release/v1.2.3"), "release/v1.2.3");
  assert.equal(validateRef("0123456789abcdef"), "0123456789abcdef");
});

test("validateRef rejects unsafe git ref strings", () => {
  for (const ref of ["--help", "../main", "feature branch", "main^{commit}", "main:evil", "bad@{1}", "x.lock"]) {
    assert.throws(() => validateRef(ref), /Unsafe|cannot/);
  }
});

test("withRepoLock propagates failures without leaving a rejected cleanup promise", async () => {
  const expected = new Error("expected failure");
  await assert.rejects(withRepoLock("failure-test", async () => {
    throw expected;
  }), expected);

  const result = { message: "recovered" } as RepoCacheResult;
  assert.equal(await withRepoLock("failure-test", async () => result), result);
});
