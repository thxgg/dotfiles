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

function sseEvent(event: unknown): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

test("buildImageRequestBody declares Codex Responses image_generation tool", () => {
	const body = buildImageRequestBody({ prompt: "p", count: 2, quality: "auto", background: "auto", size: "auto", model: "gpt-5.5" });
	assert.equal(body.model, "gpt-5.5");
	assert.equal(body.store, false);
	assert.equal(body.stream, true);
	assert.deepEqual(body.tools, [{ type: "image_generation", model: "gpt-image-2", quality: "auto", size: "auto" }]);
	assert.equal(body.input[0]!.role, "user");
	assert.deepEqual(body.input[0]!.content[0], { type: "input_text", text: "p" });
	assert.equal(body.tool_choice, "auto");

	const editBody = buildImageRequestBody({
		prompt: "edit",
		count: 1,
		quality: "high",
		background: "auto",
		size: "1024x1024",
		model: "gpt-5.5-fast",
		imageUrls: ["data:image/png;base64,abc"],
	});
	assert.equal(editBody.model, "gpt-5.5-fast");
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
		requestBody: buildImageRequestBody({ prompt: "p", count: 2, quality: "auto", background: "auto", size: "auto", model: "gpt-5.5" }),
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
		model: "gpt-5.5",
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
	assert.equal(body.model, "gpt-5.5");
	assert.equal(body.tools[0].type, "image_generation");
	assert.equal(body.tools[0].model, "gpt-image-2");
	assert.equal(body.input[0].content[0].text, "draw a small icon");
});
