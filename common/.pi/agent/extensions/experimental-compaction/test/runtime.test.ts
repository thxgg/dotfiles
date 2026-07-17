import assert from "node:assert/strict";
import test from "node:test";
import { fileLists, formatFileOperations, retainedEntryCount } from "../index.ts";

test("cumulative file lists match native compaction semantics", () => {
  const lists = fileLists({
    read: new Set(["read.ts", "changed.ts"]),
    written: new Set(["created.ts"]),
    edited: new Set(["changed.ts"]),
  });
  assert.deepEqual(lists, {
    readFiles: ["read.ts"],
    modifiedFiles: ["changed.ts", "created.ts"],
  });
  assert.equal(
    formatFileOperations(lists.readFiles, lists.modifiedFiles),
    "\n\n<read-files>\nread.ts\n</read-files>\n\n<modified-files>\nchanged.ts\ncreated.ts\n</modified-files>",
  );
});

test("retained entry count begins at Pi's prepared suffix boundary", () => {
  assert.equal(retainedEntryCount([{ id: "a" }, { id: "b" }, { id: "c" }], "b"), 2);
  assert.equal(retainedEntryCount([{ id: "a" }], "missing"), 0);
});
