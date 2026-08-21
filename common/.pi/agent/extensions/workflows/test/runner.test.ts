import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWorkflowModel } from "../runner.ts";

const sol = { provider: "openai-codex", id: "gpt-5.6-sol" };
const fable = { provider: "anthropic", id: "claude-fable-5" };
const old = { provider: "openai-codex", id: "gpt-5.4" };
const ctx = { modelRegistry: { find(provider: string, id: string) { return [sol, fable, old].find((model) => model.provider === provider && model.id === id); } } } as any;

test("workflow model defaults to Codex GPT-5.6 Sol", () => {
  assert.equal(resolveWorkflowModel(ctx, undefined), sol);
  assert.equal(resolveWorkflowModel(ctx, "gpt-5.6-sol"), sol);
});

test("workflow model accepts only Anthropic Fable 5 as an override", () => {
  assert.equal(resolveWorkflowModel(ctx, "fable-5"), fable);
  assert.equal(resolveWorkflowModel(ctx, "anthropic/claude-fable-5"), fable);
  assert.equal(resolveWorkflowModel(ctx, "openai-codex/gpt-5.4"), undefined);
  assert.equal(resolveWorkflowModel(ctx, "openai-codex/gpt-5.6-sol-fast"), undefined);
  assert.equal(resolveWorkflowModel(ctx, "opencode/claude-fable-5"), undefined);
});
