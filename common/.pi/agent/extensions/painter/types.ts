export const IMAGE_MODEL = "gpt-image-2";
export const CODEX_PROVIDER = "openai-codex";
export const CODEX_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";
export const DIRECT_IMAGE_TIMEOUT_MS = 180_000;
export const DIRECT_IMAGE_MAX_RETRIES = 1;
export const MAX_COUNT = 4;
export const MAX_INPUT_IMAGES = 5;
export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024;

export type ImageEndpointType = "generation" | "edit";
export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageBackground = "auto";
export type SupportedImageMime = "image/png" | "image/jpeg" | "image/webp";
export type GeneratedImageMime = SupportedImageMime;

export interface NormalizedImageOptions {
	prompt: string;
	count: number;
	quality: ImageQuality;
	background: ImageBackground;
	size: string;
	requestedSize?: string;
	aspectRatio?: string;
	basename: string;
}

export interface PreparedInputImage {
	suppliedPath: string;
	resolvedPath: string;
	mime: SupportedImageMime;
	byteSize: number;
	dataUrl: string;
}

export interface GeneratedImage {
	index: number;
	bytes: Buffer;
	base64: string;
	mime: GeneratedImageMime;
	extension: "png" | "jpg" | "webp";
	revisedPrompt?: string;
	outputFormat?: string;
	metadata: Record<string, unknown>;
}

export interface DirectImageRequestBody {
	model: string;
	store: false;
	stream: true;
	instructions: string;
	input: Array<{
		role: "user";
		content: Array<Record<string, unknown>>;
	}>;
	tools: Array<Record<string, unknown>>;
	text: { verbosity: "low" };
	include: string[];
	tool_choice: "auto";
	parallel_tool_calls: true;
}

export interface DirectImageClientRequest {
	token: string;
	authHeaders?: Record<string, string>;
	model: string;
	prompt: string;
	inputImages: PreparedInputImage[];
	count: number;
	quality: ImageQuality;
	background: ImageBackground;
	size: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	maxRetries?: number;
	fetchFn?: typeof fetch;
}

export interface DirectImageClientResult {
	endpointType: ImageEndpointType;
	requestId: string;
	responseId?: string;
	created?: number;
	attempts: number;
	retryCount: number;
	warnings: string[];
	requestBody: DirectImageRequestBody;
	responseMetadata: Record<string, unknown>;
	images: GeneratedImage[];
}

export interface SavedGeneratedImage {
	index: number;
	path: string;
	metadataPath: string;
	mime: GeneratedImageMime;
	byteSize: number;
	sha256: string;
	revisedPrompt?: string;
	outputFormat?: string;
}

export interface GenerateImageDetails {
	status: "validating" | "requesting" | "saving" | "done" | "error";
	endpointType?: ImageEndpointType;
	requestedCount?: number;
	generatedCount?: number;
	warnings?: string[];
	options?: {
		size: string;
		quality: ImageQuality;
		background: ImageBackground;
		count: number;
		aspectRatio?: string;
	};
	artifactsDir?: string;
	images?: SavedGeneratedImage[];
	requestId?: string;
	responseId?: string;
	retryCount?: number;
	error?: string;
}
