import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { truncateTextOutput } from "../truncation.ts";

test("truncateTextOutput writes the full output to a temp file when truncated", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "web-tools-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const output = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
	const truncated = await truncateTextOutput(output, {
		maxLines: 5,
		maxBytes: 10_000,
		tempPrefix: "pi-webfetch-",
		storeOptions: { directory, now: () => 2_000_000_000_000, env: {} },
		fileName: "output.txt",
	});

	assert.equal(truncated.truncated, true);
	assert.ok(truncated.fullOutputPath);
	assert.match(truncated.text, /Output truncated:/);
	assert.match(truncated.text, /eligible for cleanup after 7 days/);
	const saved = await readFile(truncated.fullOutputPath!, "utf8");
	assert.equal(saved, output);
});
