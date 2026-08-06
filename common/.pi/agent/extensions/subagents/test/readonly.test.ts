import assert from "node:assert/strict";
import { test } from "node:test";
import { isReadOnlyCommand } from "../readonly.ts";

test("read-only policy accepts Pi-prefixed safe git inspection", () => {
  assert.equal(isReadOnlyCommand("export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no\ngit status --short --untracked-files=all"), true);
  assert.equal(isReadOnlyCommand("GIT_PAGER=cat git diff --stat"), true);
});

test("read-only policy accepts safe compound inspection commands", () => {
  assert.equal(isReadOnlyCommand("printf 'MODEL=%s\\n' \"$PI_MODEL\"; git status --short; git diff --stat"), true);
  assert.equal(isReadOnlyCommand("pwd && git rev-parse HEAD\nprintf 'done\\n'"), true);
});

test("read-only policy still rejects mutations behind environment prefixes", () => {  assert.equal(isReadOnlyCommand("export GIT_EDITOR=true\ngit commit -m nope"), false);
  assert.equal(isReadOnlyCommand("GIT_PAGER=cat git reset --hard"), false);
  assert.equal(isReadOnlyCommand("git status --short; git reset --hard"), false);
  assert.equal(isReadOnlyCommand("git status | tee /tmp/status"), false);
  assert.equal(isReadOnlyCommand("echo $(rm -rf /tmp/nope)"), false);
});
