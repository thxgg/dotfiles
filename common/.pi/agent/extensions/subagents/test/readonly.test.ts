import assert from "node:assert/strict";
import { test } from "node:test";
import { isReadOnlyCommand } from "../readonly.ts";

test("read-only policy accepts Pi-prefixed safe git inspection", () => {
  assert.equal(isReadOnlyCommand("export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no\ngit status --short --untracked-files=all"), true);
  assert.equal(isReadOnlyCommand("GIT_PAGER=cat git diff --stat"), true);
});

test("read-only policy still rejects mutations behind environment prefixes", () => {
  assert.equal(isReadOnlyCommand("export GIT_EDITOR=true\ngit commit -m nope"), false);
  assert.equal(isReadOnlyCommand("GIT_PAGER=cat git reset --hard"), false);
});
