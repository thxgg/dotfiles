import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { applySettings, DEFAULT_CONFIG } from "../config.ts";
import { TerminalFocusParser } from "../focus.ts";
import { latestUserTurn } from "../index.ts";
import { normalizeSummary, selectRecapEntries, serializeRecapEntries, truncateTranscript } from "../summary.ts";

function entry(id: string, type: SessionEntry["type"], role?: "user" | "assistant"): SessionEntry {
  return {
    id,
    type,
    ...(type === "message" ? {
      message: role === "user"
        ? { role, content: [{ type: "text", text: id }], timestamp: 0 }
        : { role, content: [{ type: "text", text: id }], timestamp: 0 },
    } : {}),
  } as SessionEntry;
}

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

test("latest user turn is a stable deduplication key", () => {
  const entries = [
    entry("user-1", "message", "user"),
    entry("assistant-1", "message", "assistant"),
    entry("user-2", "message", "user"),
  ];
  assert.deepEqual(latestUserTurn(entries), { key: "user-2", count: 2 });
});

test("recap settings clamp away thresholds to thirty seconds", () => {
  assert.equal(DEFAULT_CONFIG.debounceMs, 30_000);
  assert.equal(applySettings(DEFAULT_CONFIG, { debounceMs: 150 }).debounceMs, 30_000);
});

test("recap context keeps latest memory and thirty recent messages", () => {
  const entries = [
    entry("old-memory", "compaction"),
    ...Array.from({ length: 10 }, (_, index) => entry(`old-${index}`, "message", "assistant")),
    entry("latest-memory", "branch_summary"),
    ...Array.from({ length: 35 }, (_, index) => entry(`recent-${index}`, "message", "assistant")),
  ];
  const selected = selectRecapEntries(entries);
  assert.equal(selected.length, 31);
  assert.equal(selected[0]?.id, "latest-memory");
  assert.equal(selected[1]?.id, "recent-5");
  assert.equal(selected.at(-1)?.id, "recent-34");
});

test("recap serialization preserves memory and every selected message", () => {
  const entries = [
    entry("memory", "compaction"),
    ...Array.from({ length: 30 }, (_, index) => entry(`message-${index}`, "message", "user")),
  ];
  const transcript = serializeRecapEntries(entries, 4_000);
  assert.ok(transcript.length <= 4_000);
  assert.match(transcript, /\[Session memory\]/);
  assert.match(transcript, /\[Recent conversation\]/);
  for (let index = 0; index < 30; index += 1) assert.match(transcript, new RegExp(`message-${index}\\b`));
});
