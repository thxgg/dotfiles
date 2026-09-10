import assert from "node:assert/strict";
import test from "node:test";
import { detailPreview } from "../preview.ts";

test("detail previews bound traversal, depth, cycles, and image copies", () => {
  const value: Record<string, unknown> = { data: "base64".repeat(20_000) };
  value.self = value;
  for (let i = 0; i < 100_000; i++) value[`key${i}`] = "long".repeat(1000);
  const preview = detailPreview(value);
  assert.ok(preview.length <= 8000);
  assert.match(preview, /binary data omitted/);
  assert.match(preview, /circular/);
  assert.doesNotMatch(preview, /base64/);
});
