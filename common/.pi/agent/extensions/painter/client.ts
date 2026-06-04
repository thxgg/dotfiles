import { randomUUID } from "node:crypto";
import { arch, platform, release } from "node:os";
import {
	CODEX_RESPONSES_BASE_URL,
	DIRECT_IMAGE_MAX_RETRIES,
	DIRECT_IMAGE_TIMEOUT_MS,
	IMAGE_MODEL,
	type DirectImageClientRequest,
	type DirectImageClientResult,
	type DirectImageRequestBody,
	type GeneratedImage,
	type ImageBackground,
	type GeneratedImageMime,
	type ImageEndpointType,
	type ImageQuality,
} from "./types.ts";

const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const ERROR_BODY_LIMIT = 2_000;
const SSE_HEADER_TIMEOUT_MS = 10_000;

export class DirectImageEndpointError extends Error {
	readonly endpointType: ImageEndpointType;
	readonly status?: number;
	readonly requestId?: string;
	readonly responseId?: string;
	readonly retryCount: number;
	readonly body?: string;

	constructor(message: string, details: {
		endpointType: ImageEndpointType;
		status?: number;
		requestId?: string;
		responseId?: string;
		retryCount: number;
		body?: string;
	}) {
		super(message);
		this.name = "DirectImageEndpointError";
		this.endpointType = details.endpointType;
		this.status = details.status;
		this.requestId = details.requestId;
		this.responseId = details.responseId;
		this.retryCount = details.retryCount;
		this.body = details.body;
	}
}

export function buildImageRequestBody(params: {
	prompt: string;
	count: number;
	quality: ImageQuality;
	background: ImageBackground;
	size: string;
	model: string;
	imageUrls?: string[];
}): DirectImageRequestBody {
	const content: Array<Record<string, unknown>> = [{ type: "input_text", text: params.prompt }];
	for (const imageUrl of params.imageUrls ?? []) {
		content.push({ type: "input_image", image_url: imageUrl, detail: "auto" });
	}

	const tool: Record<string, unknown> = {
		type: "image_generation",
		model: IMAGE_MODEL,
		quality: params.quality,
		size: params.size,
	};

	return {
		model: params.model,
		store: false,
		stream: true,
		instructions: buildImageInstructions(params.count, params.imageUrls?.length ? "edit" : "generation"),
		input: [{ role: "user", content }],
		tools: [tool],
		text: { verbosity: "low" },
		include: ["reasoning.encrypted_content"],
		tool_choice: "auto",
		parallel_tool_calls: true,
	};
}

export function extractChatGptAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("invalid JWT");
		const payload = JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>;
		const authClaim = payload[JWT_CLAIM_PATH];
		if (!authClaim || typeof authClaim !== "object" || Array.isArray(authClaim)) {
			throw new Error("missing auth claim");
		}
		const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
		if (typeof accountId !== "string" || accountId.length === 0) {
			throw new Error("missing account id");
		}
		return accountId;
	} catch {
		throw new Error("Failed to extract ChatGPT account ID from Codex OAuth token. Refresh/open openai-codex/ChatGPT OAuth credentials outside the tool.");
	}
}

export function buildCodexImageHeaders(params: {
	token: string;
	authHeaders?: Record<string, string>;
	requestId?: string;
}): Headers {
	const accountId = extractChatGptAccountId(params.token);
	const headers = new Headers(params.authHeaders ?? {});
	headers.set("Authorization", `Bearer ${params.token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("originator", "pi");
	headers.set("User-Agent", `pi (${platform()} ${release()}; ${arch()})`);
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("Accept", "text/event-stream");
	headers.set("Content-Type", "application/json");
	if (params.requestId) {
		headers.set("x-client-request-id", params.requestId);
		headers.set("session-id", params.requestId);
	}
	return headers;
}

export async function callDirectImageEndpoint(request: DirectImageClientRequest): Promise<DirectImageClientResult> {
	const endpointType: ImageEndpointType = request.inputImages.length > 0 ? "edit" : "generation";
	const fetchFn = request.fetchFn ?? fetch;
	const timeoutMs = request.timeoutMs ?? DIRECT_IMAGE_TIMEOUT_MS;
	const maxRetries = request.maxRetries ?? DIRECT_IMAGE_MAX_RETRIES;
	const images: GeneratedImage[] = [];
	const warnings: string[] = [];
	let lastRequestBody: DirectImageRequestBody | undefined;
	let lastResponseMetadata: Record<string, unknown> = {};
	let firstRequestId: string | undefined;
	let lastResponseId: string | undefined;
	let totalAttempts = 0;
	let retryCount = 0;

	for (let index = 0; index < request.count; index += 1) {
		const prompt = request.count > 1
			? `${request.prompt}\n\nVariant ${index + 1} of ${request.count}; keep the same prompt and produce one distinct image.`
			: request.prompt;
		const single = await callSingleResponsesImage({
			...request,
			prompt,
			count: 1,
			endpointType,
			fetchFn,
			timeoutMs,
			maxRetries,
		});
		if (!firstRequestId) firstRequestId = single.requestId;
		lastResponseId = single.responseId;
		lastRequestBody = single.requestBody;
		lastResponseMetadata = single.responseMetadata;
		totalAttempts += single.attempts;
		retryCount += single.retryCount;
		if (single.warnings.length > 0) warnings.push(...single.warnings.map((warning) => `Image ${index + 1}: ${warning}`));
		for (const image of single.images) {
			images.push({ ...image, index: images.length + 1 });
		}
	}

	if (images.length === 0) {
		throw new DirectImageEndpointError("GPT Image 2 response did not contain any valid images.", {
			endpointType,
			requestId: firstRequestId,
			responseId: lastResponseId,
			retryCount,
		});
	}
	if (images.length < request.count) {
		warnings.push(`Requested ${request.count} image(s), but GPT Image 2 returned ${images.length}.`);
	}

	return {
		endpointType,
		requestId: firstRequestId ?? createRequestId(),
		responseId: lastResponseId,
		attempts: totalAttempts,
		retryCount,
		warnings,
		requestBody: lastRequestBody ?? buildImageRequestBody({
			prompt: request.prompt,
			count: request.count,
			quality: request.quality,
			background: request.background,
			size: request.size,
			model: request.model,
			imageUrls: request.inputImages.map((image) => image.dataUrl),
		}),
		responseMetadata: lastResponseMetadata,
		images,
	};
}

export function parseDirectImageResponse(json: unknown, context: {
	endpointType: ImageEndpointType;
	requestId: string;
	responseId?: string;
	attempts: number;
	retryCount: number;
	requestBody: DirectImageRequestBody;
	requestedCount: number;
	responseMetadataSource?: unknown;
}): DirectImageClientResult {
	const imageItems = extractImageGenerationItems(json);
	const metadataSource = context.responseMetadataSource ?? json;
	const responseMetadata = sanitizeResponseMetadata(isRecord(metadataSource) ? metadataSource : {});
	const images: GeneratedImage[] = [];
	const warnings: string[] = [];
	let dataIndex = 0;
	for (const item of imageItems) {
		dataIndex += 1;
		if (typeof item.result !== "string" || item.result.length === 0) {
			warnings.push(`Skipped image ${dataIndex}: missing image_generation_call result.`);
			continue;
		}
		const bytes = Buffer.from(item.result, "base64");
		if (bytes.length === 0) {
			warnings.push(`Skipped image ${dataIndex}: empty image bytes.`);
			continue;
		}
		const metadata = sanitizeImageMetadata(item);
		const mime = detectGeneratedMime(bytes, stringField(item.output_format));
		images.push({
			index: images.length + 1,
			bytes,
			base64: item.result,
			mime,
			extension: extensionForMime(mime),
			revisedPrompt: stringField(item.revised_prompt),
			outputFormat: stringField(item.output_format) ?? extensionForMime(mime),
			metadata,
		});
	}

	if (images.length === 0) {
		throw new DirectImageEndpointError("GPT Image 2 response did not contain any valid images.", {
			endpointType: context.endpointType,
			requestId: context.requestId,
			responseId: context.responseId,
			retryCount: context.retryCount,
		});
	}
	if (images.length < context.requestedCount) {
		warnings.push(`Requested ${context.requestedCount} image(s), but GPT Image 2 returned ${images.length}.`);
	}

	return {
		endpointType: context.endpointType,
		requestId: context.requestId,
		responseId: context.responseId ?? responseIdFromJson(metadataSource) ?? responseIdFromJson(json),
		created: createdFromJson(metadataSource) ?? createdFromJson(json),
		attempts: context.attempts,
		retryCount: context.retryCount,
		warnings,
		requestBody: context.requestBody,
		responseMetadata,
		images,
	};
}

export function detectGeneratedMime(bytes: Buffer, outputFormat?: string): GeneratedImageMime {
	if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return "image/png";
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		bytes.length >= 12 &&
		bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
		bytes.subarray(8, 12).toString("ascii") === "WEBP"
	) {
		return "image/webp";
	}
	const fromFormat = mimeFromOutputFormat(outputFormat);
	return fromFormat ?? "image/png";
}

export function extensionForMime(mime: GeneratedImageMime): "png" | "jpg" | "webp" {
	if (mime === "image/jpeg") return "jpg";
	if (mime === "image/webp") return "webp";
	return "png";
}

async function callSingleResponsesImage(request: DirectImageClientRequest & {
	endpointType: ImageEndpointType;
	fetchFn: typeof fetch;
	timeoutMs: number;
	maxRetries: number;
}): Promise<DirectImageClientResult> {
	const requestId = createRequestId();
	const requestBody = buildImageRequestBody({
		prompt: request.prompt,
		count: 1,
		quality: request.quality,
		background: request.background,
		size: request.size,
		model: request.model,
		imageUrls: request.inputImages.map((image) => image.dataUrl),
	});
	const headers = buildCodexImageHeaders({ token: request.token, authHeaders: request.authHeaders, requestId });
	let lastTransportError: unknown;

	for (let attempt = 0; attempt <= request.maxRetries; attempt += 1) {
		throwIfAborted(request.signal);
		const attemptSignal = createAttemptSignal(request.signal, request.timeoutMs);
		try {
			const response = await request.fetchFn(CODEX_RESPONSES_BASE_URL, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
				signal: attemptSignal.signal,
			});

			if (!response.ok) {
				const body = await readSanitizedErrorBody(response);
				const responseId = getResponseId(response.headers, body);
				if (attempt < request.maxRetries && isRetryableStatus(response.status)) {
					await sleepAbortable(1_000, request.signal);
					continue;
				}
				throw buildEndpointError({
					endpointType: request.endpointType,
					status: response.status,
					statusText: response.statusText,
					requestId,
					responseId,
					retryCount: attempt,
					body,
				});
			}

			const events = await readResponsesSse(response, request.signal);
			const terminal = terminalResponseEvent(events);
			const responseId = getResponseId(response.headers, terminal) ?? responseIdFromJson(terminal);
			return parseDirectImageResponse(events, {
				endpointType: request.endpointType,
				requestId,
				responseId,
				attempts: attempt + 1,
				retryCount: attempt,
				requestBody,
				requestedCount: 1,
				responseMetadataSource: terminal,
			});
		} catch (error) {
			if (request.signal?.aborted) {
				throw new Error("GPT Image 2 request cancelled.");
			}
			if (attemptSignal.timedOut()) {
				throw new Error(`GPT Image 2 ${request.endpointType} request timed out after ${Math.round(request.timeoutMs / 1000)}s.`);
			}
			if (error instanceof DirectImageEndpointError) {
				throw error;
			}
			lastTransportError = error;
			if (attempt < request.maxRetries && isRetryableTransportError(error)) {
				await sleepAbortable(1_000, request.signal);
				continue;
			}
			const message = sanitizeErrorText(error instanceof Error ? error.message : String(error));
			throw new DirectImageEndpointError(
				`GPT Image 2 ${request.endpointType} request failed after ${attempt} ${attempt === 1 ? "retry" : "retries"}: ${message}`,
				{ endpointType: request.endpointType, requestId, retryCount: attempt, body: message },
			);
		} finally {
			attemptSignal.cleanup();
		}
	}

	const message = sanitizeErrorText(lastTransportError instanceof Error ? lastTransportError.message : String(lastTransportError ?? "unknown error"));
	throw new DirectImageEndpointError(`GPT Image 2 ${request.endpointType} request failed: ${message}`, {
		endpointType: request.endpointType,
		requestId,
		retryCount: request.maxRetries,
		body: message,
	});
}

async function readResponsesSse(response: Response, signal: AbortSignal | undefined): Promise<unknown[]> {
	if (!response.body) return [];
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const events: unknown[] = [];
	let buffer = "";
	let gotHeaders = false;
	const headerTimeout = setTimeout(() => {
		if (!gotHeaders) reader.cancel(new Error("SSE response headers timed out")).catch(() => undefined);
	}, SSE_HEADER_TIMEOUT_MS);
	try {
		while (true) {
			throwIfAborted(signal);
			const { done, value } = await reader.read();
			gotHeaders = true;
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx = buffer.indexOf("\n\n");
			while (idx !== -1) {
				const chunk = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const data = chunk
					.split("\n")
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trim())
					.join("\n")
					.trim();
				if (data && data !== "[DONE]") {
					let event: unknown;
					try {
						event = JSON.parse(data) as unknown;
					} catch {
						throw new Error("Codex Responses stream returned invalid JSON.");
					}
					throwIfResponseFailed(event);
					events.push(event);
				}
				idx = buffer.indexOf("\n\n");
			}
		}
	} finally {
		clearTimeout(headerTimeout);
		try {
			await reader.cancel();
		} catch { }
		try {
			reader.releaseLock();
		} catch { }
	}
	return events;
}

function throwIfResponseFailed(event: unknown): void {
	if (!isRecord(event)) return;
	if (event.type === "error") {
		throw new Error(stringField(event.message) ?? stringField(event.code) ?? "Codex Responses stream returned an error.");
	}
	if (event.type === "response.failed") {
		const response = isRecord(event.response) ? event.response : undefined;
		const error = response && isRecord(response.error) ? response.error : undefined;
		throw new Error(stringField(error?.message) ?? stringField(error?.code) ?? "Codex Responses stream failed.");
	}
}

function terminalResponseEvent(events: unknown[]): unknown {
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const event = events[i];
		if (isRecord(event) && isRecord(event.response) && (event.type === "response.completed" || event.type === "response.done" || event.type === "response.incomplete")) {
			return event.response;
		}
	}
	return events;
}

function extractImageGenerationItems(value: unknown): Array<Record<string, unknown>> {
	const items: Array<Record<string, unknown>> = [];
	const visit = (entry: unknown) => {
		if (Array.isArray(entry)) {
			for (const item of entry) visit(item);
			return;
		}
		if (!isRecord(entry)) return;
		if (entry.type === "image_generation_call") {
			items.push(entry);
		}
		if (isRecord(entry.item)) visit(entry.item);
		if (isRecord(entry.response)) visit(entry.response);
		if (Array.isArray(entry.output)) visit(entry.output);
	};
	visit(value);
	return dedupeImageItems(items);
}

function dedupeImageItems(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const byId = new Map<string, Record<string, unknown>>();
	const withoutId: Array<Record<string, unknown>> = [];
	for (const item of items) {
		const id = stringField(item.id);
		if (!id) {
			withoutId.push(item);
			continue;
		}
		const prev = byId.get(id);
		if (!prev || (typeof item.result === "string" && typeof prev.result !== "string")) {
			byId.set(id, item);
		}
	}
	return [...byId.values(), ...withoutId];
}

function buildImageInstructions(count: number, endpointType: ImageEndpointType): string {
	const base = endpointType === "edit"
		? "Use the image_generation tool to edit or transform the provided image input(s) according to the user's prompt."
		: "Use the image_generation tool to create a raster image according to the user's prompt.";
	return `${base} Generate exactly one image in this request. Do not answer with text instead of using image_generation. Do not mention downloads or file paths. Requested total image count for the outer tool is ${count}.`;
}

function createRequestId(): string {
	try {
		return randomUUID();
	} catch {
		return `pi_image_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	}
}

function base64UrlDecode(value: string): string {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	return Buffer.from(padded, "base64").toString("utf8");
}

function isRetryableStatus(status: number): boolean {
	return status >= 500 && status <= 599;
}

function isRetryableTransportError(error: unknown): boolean {
	if (!(error instanceof Error)) return true;
	if (error.name === "AbortError") return false;
	return true;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error("GPT Image 2 request cancelled.");
}

function createAttemptSignal(parent: AbortSignal | undefined, timeoutMs: number): {
	signal: AbortSignal;
	cleanup: () => void;
	timedOut: () => boolean;
} {
	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error("request timeout"));
	}, timeoutMs);
	const onAbort = () => controller.abort(parent?.reason ?? new Error("request aborted"));
	if (parent) {
		if (parent.aborted) onAbort();
		else parent.addEventListener("abort", onAbort, { once: true });
	}
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timeout);
			parent?.removeEventListener("abort", onAbort);
		},
		timedOut: () => timedOut,
	};
}

function sleepAbortable(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("request aborted"));
			return;
		}
		const cleanup = () => signal?.removeEventListener("abort", onAbort);
		const timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			cleanup();
			reject(new Error("request aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function readSanitizedErrorBody(response: Response): Promise<string> {
	try {
		return sanitizeErrorText(await response.text());
	} catch {
		return "";
	}
}

function buildEndpointError(params: {
	endpointType: ImageEndpointType;
	status: number;
	statusText: string;
	requestId: string;
	responseId?: string;
	retryCount: number;
	body: string;
}): DirectImageEndpointError {
	const idText = params.responseId ? `, response ${params.responseId}` : "";
	const bodyText = params.body ? `: ${params.body}` : "";
	const authHint = params.status === 401 || params.status === 403
		? " Refresh/open openai-codex/ChatGPT OAuth credentials outside the tool."
		: "";
	return new DirectImageEndpointError(
		`GPT Image 2 ${params.endpointType} request failed (${params.status} ${params.statusText || "HTTP error"}, ${params.retryCount} ${params.retryCount === 1 ? "retry" : "retries"}${idText})${bodyText}${authHint}`,
		params,
	);
}

function sanitizeErrorText(text: string): string {
	return text
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		.replace(/chatgpt-account-id[\"':=\s]+[A-Za-z0-9_-]+/gi, "chatgpt-account-id [redacted]")
		.replace(/authorization[\"':=\s]+[^,}\]\s]+/gi, "authorization [redacted]")
		.slice(0, ERROR_BODY_LIMIT);
}

function getResponseId(headers: Headers, bodyOrJson: unknown): string | undefined {
	return headers.get("x-request-id")
		?? headers.get("x-openai-request-id")
		?? headers.get("openai-request-id")
		?? headers.get("cf-ray")
		?? responseIdFromJson(bodyOrJson);
}

function responseIdFromJson(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	return stringField(value.id)
		?? stringField(value.request_id)
		?? (isRecord(value.response) ? responseIdFromJson(value.response) : undefined);
}

function createdFromJson(value: unknown): number | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value.created === "number" ? value.created : undefined;
}

function sanitizeResponseMetadata(json: Record<string, unknown>): Record<string, unknown> {
	const metadata: Record<string, unknown> = {};
	for (const key of ["id", "created", "status", "model", "service_tier", "usage", "error"] as const) {
		if (json[key] !== undefined) metadata[key] = sanitizeJsonValue(json[key]);
	}
	return metadata;
}

function sanitizeImageMetadata(item: Record<string, unknown>): Record<string, unknown> {
	const metadata: Record<string, unknown> = {};
	for (const key of ["id", "status", "revised_prompt", "output_format", "background", "quality", "size"] as const) {
		if (item[key] !== undefined) metadata[key] = sanitizeJsonValue(item[key]);
	}
	return metadata;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
	if (depth > 4) return "[truncated]";
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeJsonValue(item, depth + 1));
	if (isRecord(value)) {
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value).slice(0, 50)) {
			if (isSensitiveMetadataKey(key)) continue;
			result[key] = sanitizeJsonValue(entry, depth + 1);
		}
		return result;
	}
	return String(value);
}

function isSensitiveMetadataKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return normalized.includes("b64")
		|| normalized.includes("base64")
		|| normalized === "result"
		|| normalized === "authorization"
		|| normalized === "auth"
		|| normalized === "api_key"
		|| normalized === "apikey"
		|| normalized === "token"
		|| normalized.endsWith("_token")
		|| normalized.endsWith("-token")
		|| normalized.includes("account_id")
		|| normalized.includes("account-id");
}

function mimeFromOutputFormat(outputFormat: string | undefined): GeneratedImageMime | undefined {
	const normalized = outputFormat?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === "png" || normalized === "image/png") return "image/png";
	if (normalized === "jpeg" || normalized === "jpg" || normalized === "image/jpeg") return "image/jpeg";
	if (normalized === "webp" || normalized === "image/webp") return "image/webp";
	return undefined;
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
