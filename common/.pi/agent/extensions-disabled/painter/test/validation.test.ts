import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	detectSupportedInputMime,
	normalizeImageOptions,
	normalizeRequestedSize,
	readAndValidateInputImages,
	resolveInputImagePath,
	sanitizeBasename,
	validateCount,
} from "../validation.ts";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "ascii")]);

test("validateCount defaults to 1 and rejects non-integer/out-of-range values", () => {
	assert.equal(validateCount(undefined), 1);
	assert.equal(validateCount(1), 1);
	assert.equal(validateCount(4), 4);
	assert.throws(() => validateCount(0), /1 to 4/);
	assert.throws(() => validateCount(5), /1 to 4/);
	assert.throws(() => validateCount(1.5), /integer/);
});

test("normalizeRequestedSize maps aspect ratios and validates explicit GPT Image 2 sizes", () => {
	assert.deepEqual(normalizeRequestedSize(undefined, undefined), { size: "auto" });
	assert.deepEqual(normalizeRequestedSize(undefined, "16:9"), { size: "1536x864", aspectRatio: "16:9" });
	assert.deepEqual(normalizeRequestedSize("1024x1024", undefined), { size: "1024x1024", requestedSize: "1024x1024" });
	assert.throws(() => normalizeRequestedSize("1024x1024", "square"), /either size or aspectRatio/);
	assert.throws(() => normalizeRequestedSize("1000x1000", undefined), /multiples of 16/);
	assert.throws(() => normalizeRequestedSize("4096x4096", undefined), /max edge/);
	assert.throws(() => normalizeRequestedSize("1536x256", undefined), /aspect ratio|total pixels/);
});

test("normalizeImageOptions preserves the exact prompt and applies defaults", () => {
	const options = normalizeImageOptions({ prompt: "  a cat in watercolor  ", basename: "My Cat!", aspectRatio: "square" });
	assert.equal(options.prompt, "  a cat in watercolor  ");
	assert.equal(options.count, 1);
	assert.equal(options.quality, "auto");
	assert.equal(options.background, "auto");
	assert.equal(options.size, "1024x1024");
	assert.equal(options.basename, "My-Cat");
});

test("sanitizeBasename creates a bounded slug with fallback", () => {
	assert.equal(sanitizeBasename("  Hello, World!!  "), "Hello-World");
	assert.equal(sanitizeBasename("***"), "image");
	assert.equal(sanitizeBasename("a".repeat(80)).length, 48);
	assert.equal(sanitizeBasename(undefined), "image");
});

test("resolveInputImagePath expands relative, absolute, and home paths", () => {
	const cwd = "/tmp/project";
	assert.equal(resolveInputImagePath(cwd, "images/a.png"), resolve(cwd, "images/a.png"));
	assert.equal(resolveInputImagePath(cwd, "/var/tmp/a.png"), "/var/tmp/a.png");
	assert.equal(resolveInputImagePath(cwd, "~/a.png"), join(homedir(), "a.png"));
});

test("detectSupportedInputMime recognizes PNG, JPEG, and WebP magic bytes", () => {
	assert.equal(detectSupportedInputMime(PNG_BYTES), "image/png");
	assert.equal(detectSupportedInputMime(JPEG_BYTES), "image/jpeg");
	assert.equal(detectSupportedInputMime(WEBP_BYTES), "image/webp");
	assert.equal(detectSupportedInputMime(Buffer.from("<svg></svg>")), undefined);
});

test("readAndValidateInputImages resolves paths, reads data URLs, and rejects unsupported files", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-painter-validation-"));
	await writeFile(join(dir, "input.png"), PNG_BYTES);
	await writeFile(join(dir, "bad.svg"), Buffer.from("<svg></svg>"));

	const images = await readAndValidateInputImages(dir, ["input.png"]);
	assert.equal(images.length, 1);
	assert.equal(images[0]!.suppliedPath, "input.png");
	assert.equal(images[0]!.resolvedPath, join(dir, "input.png"));
	assert.equal(images[0]!.mime, "image/png");
	assert.equal(images[0]!.byteSize, PNG_BYTES.length);
	assert.match(images[0]!.dataUrl, /^data:image\/png;base64,/);
	await assert.rejects(() => readAndValidateInputImages(dir, ["bad.svg"]), /unsupported input image format/);
});
