import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSidecarMetadata,
	formatDate,
	formatTime,
	saveGeneratedImageArtifacts,
	sha256Hex,
} from "../artifacts.ts";
import type { DirectImageClientResult, GeneratedImage, NormalizedImageOptions, PreparedInputImage } from "../types.ts";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

test("formatDate and formatTime use local date components with padded fields", () => {
	const date = new Date(2026, 0, 2, 3, 4, 5);
	assert.equal(formatDate(date), "2026-01-02");
	assert.equal(formatTime(date), "030405");
});

test("sha256Hex computes a content hash", () => {
	assert.equal(sha256Hex(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("buildSidecarMetadata includes selected fields but not generated base64 or input data URLs", () => {
	const image = fakeImage();
	const options = fakeOptions();
	const inputImage: PreparedInputImage = {
		suppliedPath: "input.png",
		resolvedPath: "/tmp/input.png",
		mime: "image/png",
		byteSize: 9,
		dataUrl: "DATA_URL_SHOULD_NOT_APPEAR",
	};
	const metadata = buildSidecarMetadata({
		image,
		imagePath: "/tmp/out.png",
		metadataPath: "/tmp/out.json",
		sha256: "hash",
		options,
		inputImages: [inputImage],
		clientResult: fakeClientResult([image]),
		now: new Date("2026-01-02T03:04:05Z"),
	});

	const text = JSON.stringify(metadata);
	assert.equal(text.includes("BASE64_SHOULD_NOT_APPEAR"), false);
	assert.equal(text.includes("DATA_URL_SHOULD_NOT_APPEAR"), false);
	assert.equal(text.includes("authorization"), false);
	assert.equal((metadata.generatedFile as any).sha256, "hash");
	assert.deepEqual((metadata.inputImages as any[])[0], {
		index: 1,
		suppliedPath: "input.png",
		resolvedPath: "/tmp/input.png",
		mime: "image/png",
		byteSize: 9,
	});
});

test("saveGeneratedImageArtifacts writes date-based image and sidecar files", async () => {
	const previousXdg = process.env.XDG_DATA_HOME;
	const dir = await mkdtemp(join(tmpdir(), "pi-painter-artifacts-"));
	process.env.XDG_DATA_HOME = dir;
	try {
		const image = fakeImage();
		const options = fakeOptions();
		const result = await saveGeneratedImageArtifacts({
			images: [image],
			options,
			inputImages: [],
			clientResult: fakeClientResult([image]),
			now: new Date(2026, 0, 2, 3, 4, 5),
		});

		assert.equal(result.artifactsDir, join(dir, "pi", "generated-images", "2026-01-02"));
		assert.equal(result.images.length, 1);
		assert.match(result.images[0]!.path, /icon-030405-1\.png$/);
		assert.match(result.images[0]!.metadataPath, /icon-030405-1\.json$/);
		assert.equal(result.images[0]!.sha256, sha256Hex(PNG_BYTES));
		assert.deepEqual(await readFile(result.images[0]!.path), PNG_BYTES);
		const sidecar = JSON.parse(await readFile(result.images[0]!.metadataPath, "utf8"));
		assert.equal(sidecar.prompt, options.prompt);
		assert.equal(sidecar.generatedFile.sha256, sha256Hex(PNG_BYTES));
	} finally {
		if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
		else process.env.XDG_DATA_HOME = previousXdg;
	}
});

function fakeImage(): GeneratedImage {
	return {
		index: 1,
		bytes: PNG_BYTES,
		base64: "BASE64_SHOULD_NOT_APPEAR",
		mime: "image/png",
		extension: "png",
		revisedPrompt: "revised",
		outputFormat: "png",
		metadata: { output_format: "png" },
	};
}

function fakeOptions(): NormalizedImageOptions {
	return {
		prompt: "draw icon",
		count: 1,
		quality: "auto",
		background: "auto",
		size: "1024x1024",
		aspectRatio: "square",
		basename: "icon",
	};
}

function fakeClientResult(images: GeneratedImage[]): DirectImageClientResult {
	return {
		endpointType: "generation",
		requestId: "req_1",
		responseId: "resp_1",
		created: 123,
		attempts: 1,
		retryCount: 0,
		warnings: [],
		requestBody: {
			model: "gpt-5.5",
			store: false,
			stream: true,
			instructions: "Use image_generation.",
			input: [{ role: "user", content: [{ type: "input_text", text: "draw icon" }] }],
			tools: [{ type: "image_generation", model: "gpt-image-2", quality: "auto", size: "1024x1024" }],
			text: { verbosity: "low" },
			include: ["reasoning.encrypted_content"],
			tool_choice: "auto",
			parallel_tool_calls: true,
		},
		responseMetadata: { created: 123, usage: { input_tokens: 1 } },
		images,
	};
}
