import test from "node:test";
import assert from "node:assert/strict";
import {
	buildCodexImageHeaders,
	buildImageRequestBody,
	callDirectImageEndpoint,
	detectGeneratedMime,
	extensionForMime,
	extractChatGptAccountId,
	parseDirectImageResponse,
} from "../client.ts";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "ascii")]);

function base64UrlJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function fakeCodexJwt(accountId = "acct_test"): string {
	return `${base64UrlJson({ alg: "none" })}.${base64UrlJson({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })}.sig`;
}

async function requestStream(body: string, chunkSize = body.length) {
	const bytes = new TextEncoder().encode(body);
	return callDirectImageEndpoint({
		token: fakeCodexJwt(), model: "gpt-6.1-sol", prompt: "test", inputImages: [],
		count: 1, quality: "low", background: "auto", size: "auto", maxRetries: 0,
		fetchFn: async () => new Response(new ReadableStream({
			start(controller) {
				for (let offset = 0; offset < bytes.length; offset += Math.max(1, chunkSize)) {
					controller.enqueue(bytes.slice(offset, offset + Math.max(1, chunkSize)));
				}
				controller.close();
			},
		}), { headers: { "content-type": "text/event-stream" } }),
	});
}

for (const newline of ["\n", "\r\n"]) {
	test(`parses SSE with ${JSON.stringify(newline)} across byte boundaries`, async () => {
		const event = { type: "response.completed", response: { id: "resp_lines", status: "completed", output: [
			{ type: "image_generation_call", id: "img_lines", result: PNG_BYTES.toString("base64") },
		] } };
		const result = await requestStream(`data: ${JSON.stringify(event)}${newline}${newline}`, 1);
		assert.equal(result.images.length, 1);
	});
}

test("reports text-only output and redacts credentials", async () => {
	await assert.rejects(requestStream(sseEvent({ type: "response.completed", response: {
		id: "resp_text", status: "completed", output: [{ type: "message", content: [
			{ type: "output_text", text: "Image tool unavailable. Bearer secret-token sk-secret123" },
		] }],
	} })), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.match(error.message, /Image tool unavailable/);
		assert.match(error.message, /Status: completed/);
		assert.doesNotMatch(error.message, /secret-token|sk-secret123/);
		return true;
	});
});

test("reports incomplete reason and missing image warnings", async () => {
	await assert.rejects(requestStream(sseEvent({ type: "response.incomplete", response: {
		status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
		output: [{ type: "image_generation_call", id: "img_missing" }],
	} })), /max_output_tokens.*Skipped image 1/);
});

for (const body of ["", sseEvent({ type: "response.created", response: { id: "resp_cut" } }), 'data: {"type":"response.completed"}']) {
	test(`rejects empty or truncated stream: ${body.length} bytes`, async () => {
		await assert.rejects(requestStream(body), /before a terminal response event/);
	});
}

function sseEvent(event: unknown): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

test("buildImageRequestBody declares Codex Responses image_generation tool", () => {
	const body = buildImageRequestBody({ prompt: "p", count: 2, quality: "auto", background: "auto", size: "auto", model: "gpt-6.1-sol" });
	assert.equal(body.model, "gpt-6.1-sol");
	assert.equal(body.store, false);
	assert.equal(body.stream, true);
	assert.deepEqual(body.tools, [{ type: "image_generation", model: "gpt-image-2.5-sunburst", quality: "auto", size: "auto" }]);
	assert.equal(body.input[0]!.role, "user");
	assert.deepEqual(body.input[0]!.content[0], { type: "input_text", text: "p" });
	assert.deepEqual(body.tool_choice, { type: "image_generation" });

	const editBody = buildImageRequestBody({
		prompt: "edit",
		count: 1,
		quality: "high",
		background: "auto",
		size: "1024x1024",
		model: "gpt-6.1-sol",
		imageUrls: ["data:image/png;base64,abc"],
	});
	assert.equal(editBody.model, "gpt-6.1-sol");
	assert.equal(editBody.tools[0]?.model, "gpt-image-2.5-sunburst");
	assert.deepEqual(editBody.input[0]!.content[1], { type: "input_image", image_url: "data:image/png;base64,abc", detail: "auto" });
});

test("extractChatGptAccountId and buildCodexImageHeaders use sanitized Codex auth headers", () => {
	const token = fakeCodexJwt("acct_123");
	assert.equal(extractChatGptAccountId(token), "acct_123");
	const headers = buildCodexImageHeaders({ token, authHeaders: { "x-extra": "1" }, requestId: "req_123" });
	assert.equal(headers.get("authorization"), `Bearer ${token}`);
	assert.equal(headers.get("chatgpt-account-id"), "acct_123");
	assert.equal(headers.get("originator"), "pi");
	assert.equal(headers.get("content-type"), "application/json");
	assert.equal(headers.get("accept"), "text/event-stream");
	assert.equal(headers.get("openai-beta"), "responses=experimental");
	assert.equal(headers.get("x-client-request-id"), "req_123");
	assert.equal(headers.get("session-id"), "req_123");
	assert.equal(headers.get("x-extra"), "1");
	assert.throws(() => extractChatGptAccountId("not-a-jwt"), /Failed to extract/);
});

test("detectGeneratedMime prefers magic bytes, uses output_format second, and falls back to PNG", () => {
	assert.equal(detectGeneratedMime(PNG_BYTES, "jpeg"), "image/png");
	assert.equal(detectGeneratedMime(JPEG_BYTES, "png"), "image/jpeg");
	assert.equal(detectGeneratedMime(WEBP_BYTES, "png"), "image/webp");
	assert.equal(detectGeneratedMime(Buffer.from("unknown"), "webp"), "image/webp");
	assert.equal(detectGeneratedMime(Buffer.from("unknown"), undefined), "image/png");
	assert.equal(extensionForMime("image/jpeg"), "jpg");
});

test("parseDirectImageResponse extracts image_generation_call items and sanitized metadata", () => {
	const result = parseDirectImageResponse({
		id: "resp_1",
		created: 123,
		status: "completed",
		usage: { input_tokens: 1 },
		output: [
			{ type: "image_generation_call", id: "ig_1", result: PNG_BYTES.toString("base64"), revised_prompt: "short revised", output_format: "png", ignored_token: "secret" },
			{ type: "image_generation_call", id: "ig_2" },
		],
	}, {
		endpointType: "generation",
		requestId: "req_1",
		responseId: undefined,
		attempts: 1,
		retryCount: 0,
		requestedCount: 2,
		requestBody: buildImageRequestBody({ prompt: "p", count: 2, quality: "auto", background: "auto", size: "auto", model: "gpt-6.1-sol" }),
	});

	assert.equal(result.images.length, 1);
	assert.equal(result.images[0]!.mime, "image/png");
	assert.equal(result.images[0]!.revisedPrompt, "short revised");
	assert.equal(result.responseId, "resp_1");
	assert.equal(result.created, 123);
	assert.deepEqual(result.responseMetadata.usage, { input_tokens: 1 });
	assert.equal(JSON.stringify(result.responseMetadata).includes("result"), false);
	assert.equal(JSON.stringify(result.images[0]!.metadata).includes("ignored_token"), false);
	assert.match(result.warnings.join("\n"), /Skipped image 2/);
	assert.match(result.warnings.join("\n"), /Requested 2 image/);
});

test("callDirectImageEndpoint posts Codex Responses requests and parses SSE image output", async () => {
	const token = fakeCodexJwt();
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetchFn: typeof fetch = async (url, init) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(sseEvent({
			type: "response.completed",
			response: {
				id: "resp_1",
				status: "completed",
				output: [{ type: "image_generation_call", id: "ig_1", result: PNG_BYTES.toString("base64"), revised_prompt: "drawn" }],
			},
		}), {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	};

	const result = await callDirectImageEndpoint({
		token,
		model: "gpt-6.1-sol",
		prompt: "draw a small icon",
		inputImages: [],
		count: 1,
		quality: "auto",
		background: "auto",
		size: "auto",
		fetchFn,
		timeoutMs: 1_000,
		maxRetries: 0,
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0]!.url, "https://chatgpt.com/backend-api/codex/responses");
	assert.equal(result.endpointType, "generation");
	assert.equal(result.responseId, "resp_1");
	assert.equal(result.images.length, 1);
	const body = JSON.parse(String(calls[0]!.init.body));
	assert.equal(body.model, "gpt-6.1-sol");
	assert.equal(body.tools[0].type, "image_generation");
	assert.equal(body.tools[0].model, "gpt-image-2.5-sunburst");
	assert.equal(body.input[0].content[0].text, "draw a small icon");
});
