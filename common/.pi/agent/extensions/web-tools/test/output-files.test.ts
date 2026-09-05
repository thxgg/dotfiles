import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutputFiles, OUTPUT_CLEANUP_MAX_ENTRIES } from "../temp.ts";
import { getOutputSettings } from "../output-settings.ts";
import { TempFileToolOutputStore, projectFetchPageResultToPiToolResult, projectSearchWebResultToPiToolResult } from "../tool-output.ts";
import { parsePublicHttpUrl, parseSearchQuery } from "../types.ts";

const now = 2_000_000_000_000;
const cutoff = now - 7 * 86_400_000;
const name = (time: number) => `pi-webfetch-${time}-${randomUUID()}-output.txt`;

async function fixture(t: { after(fn: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), "web-tools-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const directory = join(root, "output");
	await mkdir(directory, { mode: 0o700 });
	return { root, directory, files: new OutputFiles({ directory, now: () => now, env: {} }) };
}

async function oldFile(directory: string, time: number, fileName = name(time)) {
	const path = join(directory, fileName);
	await writeFile(path, "preserved content", { mode: 0o600 });
	await utimes(path, time / 1000, time / 1000);
	return path;
}

test("output settings accept only bounded integers and preserve Pi defaults", () => {
	assert.deepEqual(getOutputSettings({}), { retentionDays: 7, maxBytes: 51200, maxLines: 2000 });
	for (const [envKey, field, min, max, fallback] of [
		["PI_WEB_TOOLS_OUTPUT_RETENTION_DAYS", "retentionDays", 1, 365, 7],
		["PI_WEB_TOOLS_OUTPUT_MAX_BYTES", "maxBytes", 1024, 51200, 51200],
		["PI_WEB_TOOLS_OUTPUT_MAX_LINES", "maxLines", 1, 2000, 2000],
	] as const) {
		for (const value of [min, max]) assert.equal(getOutputSettings({ [envKey]: String(value) })[field], value);
		for (const value of ["", "NaN", "Infinity", "1junk", "1.5", String(min - 1), String(max + 1)]) {
			assert.equal(getOutputSettings({ [envKey]: value })[field], fallback);
		}
		for (const value of [NaN, Infinity, -Infinity, min - 1, max + 1, min + 0.5]) {
			assert.equal(getOutputSettings({}, { [field]: value })[field], fallback);
		}
	}
	assert.equal(getOutputSettings({ PI_WEB_TOOLS_OUTPUT_RETENTION_DAYS: "20" }, { retentionDays: 2 }).retentionDays, 2);
});

test("output files have private permissions and unique paths", async (t) => {
	const { root, directory, files } = await fixture(t);
	await rm(directory, { recursive: true });
	const first = await files.write("pi-webfetch-", "output.txt", "full output");
	const second = await files.write("pi-websearch-", "output.txt", "other output");
	assert.notEqual(first, second);
	assert.equal((await lstat(directory)).mode & 0o777, 0o700);
	assert.equal((await lstat(first)).mode & 0o777, 0o600);
	assert.equal(await readFile(first, "utf8"), "full output");
	assert.ok(first.startsWith(root));
	await assert.rejects(files.write("../", "output.txt", "bad"));
	await assert.rejects(files.write("pi-webfetch-", "../bad", "bad"));
});

test("cleanup respects retention boundary, current outputs, symlinks and unrelated files", async (t) => {
	const { root, directory, files } = await fixture(t);
	const expired = await oldFile(directory, cutoff - 1);
	const boundary = await oldFile(directory, cutoff);
	const recent = await oldFile(directory, cutoff + 1);
	const future = await oldFile(directory, now + 1);
	const current = await oldFile(directory, cutoff - 100, name(now));
	const touched = await oldFile(directory, now, name(cutoff - 100));
	const unrelated = await oldFile(directory, cutoff - 100, "notes.txt");
	const legacy = await oldFile(root, cutoff - 100, "pi-webfetch-legacy.txt");
	const target = await oldFile(root, cutoff - 100, "target.txt");
	const symlinkPath = join(directory, name(cutoff - 100));
	await symlink(target, symlinkPath);
	const hardlinkPath = join(directory, name(cutoff - 100));
	await link(target, hardlinkPath);
	const subdir = join(directory, name(cutoff - 100));
	await mkdir(subdir);
	await writeFile(join(subdir, "output.txt"), "untouched");
	const output = await files.write("pi-webfetch-", "output.txt", "new");
	await assert.rejects(lstat(expired), { code: "ENOENT" });
	for (const path of [boundary, recent, future, current, touched, unrelated, legacy, target, symlinkPath, hardlinkPath, subdir, output]) {
		await lstat(path);
	}
	assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);
	assert.equal(await readFile(target, "utf8"), "preserved content");
});

test("cleanup is bounded and tolerates failure without preventing a write", async (t) => {
	const { directory, files } = await fixture(t);
	for (let i = 0; i < OUTPUT_CLEANUP_MAX_ENTRIES + 5; i++) await oldFile(directory, cutoff - 100);
	await files.cleanup();
	assert.equal((await readdir(directory)).length, 5);
	class FailingCleanup extends OutputFiles {
		override async cleanup() { throw new Error("cleanup unavailable"); }
	}
	const failing = new FailingCleanup({ directory, now: () => now, env: {} });
	const output = await failing.write("pi-websearch-", "output.txt", "success");
	assert.equal(await readFile(output, "utf8"), "success");
	await new OutputFiles({ directory: join(directory, "absent"), now: () => now, env: {} }).cleanup();
});

test("custom retention changes cleanup cutoff", async (t) => {
	const { directory } = await fixture(t);
	const expired = await oldFile(directory, now - 2 * 86_400_000 - 1);
	const boundary = await oldFile(directory, now - 2 * 86_400_000);
	const files = new OutputFiles({ directory, now: () => now, env: {}, retentionDays: 2 });
	await files.cleanup();
	await assert.rejects(lstat(expired), { code: "ENOENT" });
	await lstat(boundary);
});

test("unsafe output directories are not followed or modified", async (t) => {
	const { root, directory, files } = await fixture(t);
	await chmod(directory, 0o755);
	await assert.rejects(files.write("pi-webfetch-", "output.txt", "bad"));
	assert.equal((await lstat(directory)).mode & 0o777, 0o755);
	await chmod(directory, 0o700);
	const expired = await oldFile(directory, cutoff - 1);
	const alias = join(root, "alias");
	await symlink(directory, alias);
	const aliased = new OutputFiles({ directory: alias, now: () => now, env: {} });
	await aliased.cleanup();
	await assert.rejects(aliased.write("pi-webfetch-", "output.txt", "bad"));
	await lstat(expired);
});

test("byte truncation preserves UTF-8 output and short output does not create a file", async (t) => {
	const { directory } = await fixture(t);
	const url = parsePublicHttpUrl("https://example.com/");
	assert.equal(url._tag, "ok");
	const store = new TempFileToolOutputStore({ directory, now: () => now, env: {}, maxBytes: 1024 });
	for (const text of ["short", "é".repeat(1024)]) {
		const result = await projectFetchPageResultToPiToolResult({
			_tag: "Text", requestedUrl: url.value, finalUrl: url.value, format: "text", status: 200,
			mime: "text/plain", contentType: "text/plain", decoder: "utf-8", bytes: Buffer.byteLength(text), text,
		}, store);
		assert.equal(result._tag, "ok");
		if (text === "short") {
			assert.equal(result.value.details.truncated, false);
			assert.equal(result.value.details.fullOutputPath, undefined);
			assert.equal((await readdir(directory)).length, 0);
		} else {
			assert.equal(result.value.details.truncated, true);
			assert.equal(await readFile(result.value.details.fullOutputPath!, "utf8"), text);
		}
	}
});

test("fetch and search use configured truncation limits and preserve complete output", async (t) => {
	const { directory } = await fixture(t);
	const url = parsePublicHttpUrl("https://example.com/");
	const query = parseSearchQuery("example");
	assert.equal(url._tag, "ok");
	assert.equal(query._tag, "ok");
	const store = new TempFileToolOutputStore({ directory, now: () => now, env: {}, maxBytes: 1024, maxLines: 2, retentionDays: 3 });
	const text = "first\nsecond\nthird\n" + "é".repeat(1000);
	const fetched = await projectFetchPageResultToPiToolResult({
		_tag: "Text", requestedUrl: url.value, finalUrl: url.value, format: "text", status: 200,
		mime: "text/plain", contentType: "text/plain", decoder: "utf-8", bytes: Buffer.byteLength(text), text,
	}, store);
	assert.equal(fetched._tag, "ok");
	assert.equal(fetched.value.details.truncated, true);
	assert.equal(await readFile(fetched.value.details.fullOutputPath!, "utf8"), text);
	assert.match(fetched.value.content[0]?.type === "text" ? fetched.value.content[0].text : "", /eligible for cleanup after 3 days/);
	const searched = await projectSearchWebResultToPiToolResult({
		query: query.value, depth: "deep", maxResults: 8, provider: "exa", livecrawl: "preferred", contextMaxCharacters: 4000,
		results: [{ title: "Example", url: url.value, snippet: text }],
	}, store);
	assert.equal(searched._tag, "ok");
	assert.equal(searched.value.details.truncated, true);
	assert.equal(searched.value.details.livecrawl, "preferred");
	assert.equal(searched.value.details.contextMaxCharacters, 4000);
	assert.match(await readFile(searched.value.details.fullOutputPath!, "utf8"), /third/);
	assert.equal((await readdir(directory)).length, 2);
});
