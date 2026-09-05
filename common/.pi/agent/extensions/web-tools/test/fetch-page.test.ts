import test from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { ok, type Result } from "../result.ts";
import { FetchPage } from "../fetch-page.ts";
import { detectMediaSignature } from "../media.ts";
import { parsePublicHttpUrl, type WebToolsSettings } from "../types.ts";
import type { PublicWebClient, PublicWebError, PublicWebRequest, PublicWebResponse } from "../public-web-client.ts";

const requestUrl = mustParsePublicHttpUrl("https://example.com/page");

const testFetchSettings: WebToolsSettings["fetch"] = {
	defaultFormat: "markdown",
	timeoutSeconds: 30,
	maxResponseBytes: 5 * 1024 * 1024,
	blockPrivateHosts: true,
	maxRedirects: 5,
	fallbackUserAgent: "opencode",
};

class FakePublicWebClient implements PublicWebClient {
	readonly requests: PublicWebRequest[] = [];

	constructor(private readonly response: Result<PublicWebResponse, PublicWebError>) {}

	async get(
		request: PublicWebRequest,
		_options?: { readonly signal?: AbortSignal },
	): Promise<Result<PublicWebResponse, PublicWebError>> {
		this.requests.push(request);
		return this.response;
	}
}

test("FetchPage returns text responses unchanged", async () => {
	const publicWeb = new FakePublicWebClient(ok(response("text/plain; charset=utf-8", "Plain text.")));
	const service = new FetchPage({ publicWeb, settings: testFetchSettings });

	const result = await service.fetch({ url: requestUrl, format: "text" });

	assert.equal(result._tag, "ok");
	assert.equal(result.value._tag, "Text");
	assert.equal(result.value._tag === "Text" ? result.value.text : "", "Plain text.");
	assert.match(publicWeb.requests[0]?.accept ?? "", /text\/plain/);
});

test("FetchPage converts HTML to markdown when requested", async () => {
	const publicWeb = new FakePublicWebClient(
		ok(response("text/html; charset=utf-8", "<html><body><main><h1>Hello</h1><p>World</p></main></body></html>")),
	);
	const service = new FetchPage({ publicWeb, settings: testFetchSettings });

	const result = await service.fetch({ url: requestUrl, format: "markdown" });

	assert.equal(result._tag, "ok");
	assert.equal(result.value._tag, "Text");
	assert.match(result.value._tag === "Text" ? result.value.text : "", /# Hello/);
	assert.match(result.value._tag === "Text" ? result.value.text : "", /World/);
});

test("FetchPage returns raster image content", async () => {
	const png = await readFile(new URL("./fixtures/pixel.png", import.meta.url));
	const publicWeb = new FakePublicWebClient(ok(response("image/png", png)));
	const service = new FetchPage({ publicWeb, settings: testFetchSettings });

	const result = await service.fetch({ url: requestUrl, format: "markdown" });

	assert.equal(result._tag, "ok");
	assert.equal(result.value._tag, "Image");
	assert.equal(result.value._tag === "Image" ? result.value.data.toString("base64") : "", png.toString("base64"));
});

test("FetchPage rejects unsupported binary content", async () => {
	const publicWeb = new FakePublicWebClient(ok(response("application/octet-stream", Buffer.from([1, 2, 3]))));
	const service = new FetchPage({ publicWeb, settings: testFetchSettings });

	const result = await service.fetch({ url: requestUrl, format: "markdown" });

	assert.deepEqual(result, {
		_tag: "err",
		error: { _tag: "UnsupportedBinaryContent", mime: "application/octet-stream" },
	});
});

for (const [extension, mime] of [["png", "image/png"], ["jpg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"]]) {
	for (const declared of [mime!, "image/tiff", "image/jpeg", "text/plain", "application/octet-stream", ""]) {
		test(`FetchPage detects ${extension} declared as ${declared || "missing"}`, async () => {
			const body = await readFile(new URL(`./fixtures/pixel.${extension}`, import.meta.url));
			const service = new FetchPage({ publicWeb: new FakePublicWebClient(ok(response(declared, body))), settings: testFetchSettings });
			const result = await service.fetch({ url: requestUrl, format: "markdown" });
			assert.equal(result._tag, "ok");
			assert.equal(result.value._tag, "Image");
			assert.equal(result.value.mime, mime);
			assert.equal(result.value.contentType, declared);
			assert.deepEqual(result.value._tag === "Image" && result.value.data, body);
		});
	}
}

test("FetchPage rejects false image claims and incomplete signatures", async () => {
	for (const body of [Buffer.alloc(0), Buffer.from("<html>Not an image</html>"), Buffer.from("<svg/>")]) {
		await rejectsImage(body);
	}
	for (const [extension, signatureLength] of [["png", 8], ["jpg", 3], ["gif", 6], ["webp", 16]] as const) {
		const body = await readFile(new URL(`./fixtures/pixel.${extension}`, import.meta.url));
		for (let length = 1; length < signatureLength; length++) await rejectsImage(body.subarray(0, length));
	}
	await rejectsImage(Buffer.from("RIFFxxxxWAVEVP8 "));
	await rejectsImage(Buffer.from("RIFFxxxxWEBPFAKE"));
});

test("FetchPage keeps BM-prefixed text and truncated markers as text", async () => {
	for (const body of ["B", "BM", "BM is an abbreviation.", "BMW makes cars.", "BMW makes cars. ".repeat(100)]) {
		const service = new FetchPage({ publicWeb: new FakePublicWebClient(ok(response("text/plain", body))), settings: testFetchSettings });
		const result = await service.fetch({ url: requestUrl, format: "text" });
		assert.equal(result._tag, "ok");
		assert.equal(result.value._tag, "Text");
		assert.equal(result.value._tag === "Text" && result.value.text, body);
	}
});

test("BMP recognition requires plausible complete headers", async () => {
	const bmp = await readFile(new URL("./fixtures/pixel.bmp", import.meta.url));
	assert.deepEqual(detectMediaSignature(bmp), { kind: "binary", mime: "image/bmp" });
	for (const mutate of [
		(bytes: Buffer) => bytes.writeUInt32LE(1, 6), // Nonzero reserved fields.
		(bytes: Buffer) => bytes.writeUInt32LE(0, 10), // Pixels overlap the headers.
		(bytes: Buffer) => bytes.writeUInt32LE(bytes.length + 1, 2), // Incomplete file.
		(bytes: Buffer) => bytes.writeUInt32LE(13, 14), // Unknown DIB header.
		(bytes: Buffer) => bytes.writeInt32LE(0, 18), // No width.
		(bytes: Buffer) => bytes.writeInt32LE(0, 22), // No height.
		(bytes: Buffer) => bytes.writeUInt16LE(2, 26), // Invalid planes.
		(bytes: Buffer) => bytes.writeUInt16LE(3, 28), // Invalid bit depth.
	]) {
		const malformed = Buffer.from(bmp);
		mutate(malformed);
		assert.equal(detectMediaSignature(malformed), undefined);
		// Invalid headers still cannot bypass declared binary/image rejection.
		const service = new FetchPage({ publicWeb: new FakePublicWebClient(ok(response("image/bmp", malformed))), settings: testFetchSettings });
		const result = await service.fetch({ url: requestUrl, format: "text" });
		assert.equal(result._tag, "err");
		assert.equal(result.error._tag, "UnsupportedBinaryContent");
	}
	for (const length of [2, 14, 25, 30]) assert.equal(detectMediaSignature(bmp.subarray(0, length)), undefined);
});

test("FetchPage rejects BMP and PDF signatures even with text or image MIME", async () => {
	const bmp = await readFile(new URL("./fixtures/pixel.bmp", import.meta.url));
	for (const body of [bmp, Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF")]) {
		for (const declared of ["text/plain", "text/html", "image/png", "image/svg+xml", "application/octet-stream"]) {
			const service = new FetchPage({ publicWeb: new FakePublicWebClient(ok(response(declared, body))), settings: testFetchSettings });
			const result = await service.fetch({ url: requestUrl, format: "text" });
			assert.equal(result._tag, "err");
			assert.equal(result.error._tag, "UnsupportedBinaryContent");
		}
	}
});

test("FetchPage keeps SVG and raw HTML as text", async () => {
	for (const [mime, body] of [["image/svg+xml", "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"1\" height=\"1\"/></svg>"], ["text/html", "<h1>Hello</h1>"]] as const) {
		const service = new FetchPage({ publicWeb: new FakePublicWebClient(ok(response(mime, body))), settings: testFetchSettings });
		const result = await service.fetch({ url: requestUrl, format: "html" });
		assert.equal(result._tag, "ok");
		assert.equal(result.value._tag, "Text");
		assert.equal(result.value._tag === "Text" && result.value.text, body);
	}
});

async function rejectsImage(body: Buffer) {
	const service = new FetchPage({ publicWeb: new FakePublicWebClient(ok(response("image/png", body))), settings: testFetchSettings });
	const result = await service.fetch({ url: requestUrl, format: "markdown" });
	assert.equal(result._tag, "err");
	assert.equal(result.error._tag, "UnsupportedBinaryContent");
}

function response(contentType: string, body: string | Buffer): PublicWebResponse {
	const buffer = typeof body === "string" ? Buffer.from(body, "utf8") : body;
	return {
		requestedUrl: requestUrl,
		finalUrl: requestUrl,
		status: 200,
		statusText: "OK",
		headers: new Headers({ "content-type": contentType }),
		body: buffer,
		bytes: buffer.byteLength,
	};
}

function mustParsePublicHttpUrl(input: string) {
	const parsed = parsePublicHttpUrl(input);
	if (parsed._tag === "err") {
		throw new Error("Invalid test URL");
	}
	return parsed.value;
}
