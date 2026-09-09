import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWorkflowModel } from "../runner.ts";

const astra = { provider: "openai-codex", id: "gpt-6-astra" };
const fable = { provider: "anthropic", id: "claude-fable-5" };
const old = { provider: "openai-codex", id: "gpt-5.4" };
const ctx = { modelRegistry: { find(provider: string, id: string) { return [astra, fable, old].find((model) => model.provider === provider && model.id === id); } } } as any;

test("workflow model defaults to Codex GPT-6 Astra", () => {
  assert.equal(resolveWorkflowModel(ctx, undefined), astra);
  assert.equal(resolveWorkflowModel(ctx, "gpt-6-astra"), astra);
  assert.equal(resolveWorkflowModel(ctx, "openai-codex/gpt-6-astra"), astra);
  assert.equal(resolveWorkflowModel(ctx, "gpt-5.6-sol"), undefined);
});

test("workflow model accepts only Anthropic Fable 5 as an override", () => {
  assert.equal(resolveWorkflowModel(ctx, "fable-5"), fable);
  assert.equal(resolveWorkflowModel(ctx, "anthropic/claude-fable-5"), fable);
  assert.equal(resolveWorkflowModel(ctx, "openai-codex/gpt-5.4"), undefined);
  assert.equal(resolveWorkflowModel(ctx, "openai-codex/gpt-6-astra-fast"), undefined);
  assert.equal(resolveWorkflowModel(ctx, "opencode/claude-fable-5"), undefined);
});
