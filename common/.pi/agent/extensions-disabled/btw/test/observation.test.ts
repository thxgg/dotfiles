import assert from "node:assert/strict";
import test from "node:test";
import { buildParentMessages } from "../context.ts";
import { resolveSideModel } from "../model.ts";
import { filterProcessRows, parsePositivePid, textFromContent } from "../observation.ts";

test("parsePositivePid accepts only positive integers", () => {
  assert.equal(parsePositivePid(42), 42);
  assert.equal(parsePositivePid("17"), 17);
  assert.equal(parsePositivePid(0), undefined);
  assert.equal(parsePositivePid("nope"), undefined);
});

test("textFromContent joins text blocks", () => {
  assert.equal(textFromContent([{ type: "text", text: "one" }, { type: "image" }, { type: "text", text: "two" }]), "one\ntwo");
});

test("resolveSideModel rewrites the fast Sol alias", () => {
  const resolution = resolveSideModel({ provider: "openai-codex", id: "gpt-5.6-sol-fast" } as never);
  assert.equal(resolution.model.id, "gpt-5.6-sol");
  assert.deepEqual(resolution.rewritePayload({ model: "gpt-5.6-sol-fast", input: [] }), {
    model: "gpt-5.6-sol",
    input: [],
    service_tier: "priority",
  });
});

test("filterProcessRows keeps a process and its direct children", () => {
  const output = [
    "10 1 S 00:02 0.0 0.1 parent",
    "11 10 S 00:01 0.0 0.1 child",
    "12 11 S 00:01 0.0 0.1 grandchild",
  ].join("\n");
  assert.equal(filterProcessRows(output, 10), "10 1 S 00:02 0.0 0.1 parent\n11 10 S 00:01 0.0 0.1 child");
});

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function userEntry() {
  return { type: "message", id: "u", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 } };
}

test("buildParentMessages excludes an unfinished trailing assistant message", () => {
  const entries = [
    userEntry(),
    { type: "message", id: "a", parentId: "u", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "partial" }], api: "x", provider: "x", model: "x", usage, stopReason: undefined, timestamp: 2 } },
  ];
  const result = buildParentMessages(entries as never);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.role, "user");
});

test("buildParentMessages excludes a dangling completed tool call", () => {
  const entries = [
    userEntry(),
    { type: "message", id: "a", parentId: "u", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "sleep 10" } }], api: "x", provider: "x", model: "x", usage, stopReason: "toolUse", timestamp: 2 } },
  ];
  const result = buildParentMessages(entries as never);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.role, "user");
});
