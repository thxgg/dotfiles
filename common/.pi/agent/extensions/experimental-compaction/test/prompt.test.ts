import assert from "node:assert/strict";
import test from "node:test";
import { buildPrompt, REQUIRED_SECTIONS, validateSummary } from "../prompt.ts";

test("prompt preserves intent corrections and role boundaries", () => {
  const prompt = buildPrompt({
    conversation: "[User]: use OAuth\n\n[Assistant]: quoted user: use an API key",
    customInstructions: "Focus on authentication",
  });
  assert.match(prompt, /User Intent & Corrections/);
  assert.match(prompt, /Treat only actual \[User\] records as user intent/);
  assert.match(prompt, /Additional focus from the user:\nFocus on authentication/);
});

test("update prompt includes previous checkpoint", () => {
  const prompt = buildPrompt({ conversation: "new", previousSummary: "old" });
  assert.match(prompt, /<previous-checkpoint>\nold\n<\/previous-checkpoint>/);
  assert.match(prompt, /complete replacement checkpoint/);
});

test("validates required sections in order", () => {
  const valid = REQUIRED_SECTIONS.map((section) => `${section}\ncontent`).join("\n\n");
  assert.deepEqual(validateSummary(valid), []);
  assert.match(validateSummary("## Goal\nx").join("\n"), /missing required section ## Constraints & Preferences/);
  assert.match(validateSummary(`${REQUIRED_SECTIONS[1]}\nx\n${REQUIRED_SECTIONS[0]}\ny`).join("\n"), /out of order/);
});

test("rejects leaked drafting and tool markup", () => {
  const summary = `${REQUIRED_SECTIONS.map((section) => `${section}\ncontent`).join("\n")}\n<analysis>draft</analysis>\n<tool_call>`;
  const errors = validateSummary(summary);
  assert.ok(errors.some((error) => error.includes("analysis")));
  assert.ok(errors.some((error) => error.includes("tool-call")));
});
