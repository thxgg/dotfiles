import assert from "node:assert/strict";
import test from "node:test";
import { Activity, resultStatus, safeLabel, summary } from "../model.ts";
import { reconstruct, OUTSIDE_ENTRY } from "../rebuild.ts";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
const supported = () => new Set(["read", "grep", "find", "ls", "webfetch", "websearch"]);
const tool = (id: string, name = "read") => ({ type: "toolCall", id, name, arguments: { path: `路径/${id}.ts` } });
const assistant = (...content: ReturnType<typeof tool>[]) => ({ role: "assistant", content });
const ok = { content: [{ type: "text", text: "ok" }] };
const entry = (message: unknown) => ({ type: "message", message }) as SessionEntry;

test("twenty calls and tool-only messages form one stable source-ordered group", () => {
  const a = new Activity(supported());
  for (let i = 0; i < 20; i++) a.message(assistant(tool(`${i}`)));
  for (let i = 0; i < 20; i++) a.start(`${i}`, "read", {});
  assert.equal(a.groups.length, 1);
  assert.equal(a.groups[0]!.id, "0");
  assert.match(summary(a.groups[0]!.calls), /20 reads · 20 running/);
  for (let i = 19; i >= 0; i--) a.finish(`${i}`, ok);
  assert.deepEqual(a.groups[0]!.calls.map(c => c.id), Array.from({ length: 20 }, (_, i) => `${i}`));
  assert.equal(summary(a.groups[0]!.calls), "Explored · 20 reads · completed");
});
test("assistant text, user, unsupported tools, and visible custom messages split groups", () => {
  const a = new Activity(supported());
  a.message(assistant(tool("1")));
  a.message({ role: "assistant", content: [{ type: "text", text: "I will check." }, tool("2"), tool("shell", "bash"), tool("3")] });
  a.message({ role: "user", content: "Continue" });
  a.message(assistant(tool("4")));
  a.message({ role: "custom", content: "Prompt", display: true });
  a.message(assistant(tool("5")));
  assert.deepEqual(a.groups.map(g => g.calls.map(c => c.id)), [["1"], ["2"], ["3"], ["4"], ["5"]]);
});
test("duplicate starts, final results, and delayed unsupported preflight do not reorder", () => {
  const a = new Activity(supported());
  const message = assistant(tool("1"), tool("shell", "bash"), tool("2"));
  a.message(message); a.message(message);
  a.start("1", "read", {}); a.start("shell", "bash", {}); a.start("2", "read", {});
  a.finish("2", ok); a.finish("2", ok); a.start("2", "read", {});
  a.message({ role: "toolResult", toolCallId: "2", ...ok });
  a.message(assistant(tool("3")));
  assert.deepEqual(a.groups.map(g => g.calls.map(c => c.id)), [["1"], ["2", "3"]]);
  assert.equal(a.calls.get("2")!.status, "success");
});
test("failures, cancellation, and interrupted calls cannot appear successful", () => {
  const a = new Activity(supported());
  a.message(assistant(tool("1"), tool("2"), tool("3")));
  a.finish("1", { content: [{ type: "text", text: "Missing file" }], isError: true });
  a.finish("2", { content: [{ type: "text", text: "Operation aborted" }], isError: true });
  a.settle();
  assert.match(summary(a.groups[0]!.calls), /1 FAILED · 1 cancelled · 1 interrupted/);
  assert.equal(resultStatus({ ...ok, isError: true }, true), "cancelled");
  assert.equal(resultStatus(ok, true), "success");
});
test("images split a group without hiding image calls or changing stable identities", () => {
  const a = new Activity(supported());
  a.message(assistant(tool("1"), tool("2"), tool("3")));
  a.groups[0]!.expanded = true;
  a.finish("2", { content: [{ type: "image" }] });
  assert.equal(a.calls.get("2")!.outside, true);
  assert.deepEqual(a.groups.map(g => a.members(g).map(c => c.id)), [["1"], ["3"]]);
  assert.deepEqual(a.groups.map(g => g.id), ["1", "3"]);
  assert.ok(a.groups.every(g => g.expanded));
});
test("permission spans expose every possible pending sibling", () => {
  const a = new Activity(supported());
  a.message(assistant(tool("1"), tool("2")));
  a.start("1", "read", {});
  assert.deepEqual(a.prompt(), ["1", "2"]);
  assert.ok([...a.calls.values()].every(c => c.outside));
  a.message(assistant(tool("3")));
  assert.equal(a.calls.get("3")!.group, "3");
});
test("reconstruction uses only supplied active entries, deduplicates retained tails, and has no stale running calls", () => {
  const entries = [entry(assistant(tool("1"), tool("2"))), entry({ role: "toolResult", toolCallId: "1", ...ok }),
    { type: "custom", customType: OUTSIDE_ENTRY, data: ["2"] } as SessionEntry,
    entry({ role: "user", content: "Next" }), entry(assistant(tool("3")))];
  const a = reconstruct(entries, supported());
  const b = reconstruct(entries, supported());
  assert.deepEqual(a.groups, b.groups);
  assert.equal(a.calls.size, 3);
  assert.equal(a.calls.get("2")!.outside, true);
  assert.equal(a.calls.get("3")!.status, "interrupted");
  const otherBranch = reconstruct([entry(assistant(tool("other")))], supported());
  assert.deepEqual([...otherBranch.calls.keys()], ["other"]);
  assert.equal(reconstruct([], supported()).groups.length, 0);
  const compacted = reconstruct([{ type: "compaction", retainedTail: [assistant(tool("tail")), { role: "toolResult", toolCallId: "tail", ...ok }] } as unknown as SessionEntry], supported());
  assert.equal(compacted.calls.get("tail")!.status, "success");
});
test("labels are bounded and cannot inject terminal escapes", () => {
  assert.equal(safeLabel("a\x1b[2J\n路"), "a [2J 路");
  assert.equal(safeLabel("x".repeat(900)).length, 500);
});
