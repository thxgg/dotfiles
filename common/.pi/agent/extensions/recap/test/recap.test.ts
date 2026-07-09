import assert from "node:assert/strict";
import test from "node:test";
import { TerminalFocusParser } from "../focus.ts";
import { normalizeSummary, truncateTranscript } from "../summary.ts";

test("terminal parser preserves keys surrounding focus reports", () => {
  const parser = new TerminalFocusParser();
  assert.deepEqual(parser.push(`a\x1b[Ob`), { data: "ab", focused: false });
  assert.deepEqual(parser.push(`\x1b[Ic`), { data: "c", focused: true });
});

test("terminal parser handles reports split across chunks", () => {
  const parser = new TerminalFocusParser();
  assert.deepEqual(parser.push("x\x1b["), { data: "x", focused: undefined });
  assert.deepEqual(parser.push("Oy"), { data: "y", focused: false });
});

test("terminal parser never delays a standalone escape key", () => {
  const parser = new TerminalFocusParser();
  assert.deepEqual(parser.push("\x1b"), { data: "\x1b", focused: undefined });
});

test("transcript truncation stays within its budget", () => {
  const result = truncateTranscript("a".repeat(30_000), 4_000);
  assert.ok(result.length <= 4_000);
  assert.match(result, /Earlier transcript omitted/);
});

test("summary normalization removes formatting and caps output", () => {
  assert.equal(normalizeSummary("```text\nRecap: ** done now **\n```", 12), "done now");
});
