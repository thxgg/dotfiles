import { formatSize, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum, type Api, type ImageContent, type Model, type TextContent } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { saveGeneratedImageArtifacts } from "./artifacts.ts";
import { callDirectImageEndpoint, DirectImageEndpointError } from "./client.ts";
import {
	MAX_COUNT,
	MAX_INPUT_IMAGES,
	type GenerateImageDetails,
	type ImageQuality,
	IMAGE_MODEL,
	type SavedGeneratedImage,
} from "./types.ts";
import { normalizeImageOptions, readAndValidateInputImages, type GenerateImageParams } from "./validation.ts";

const TOOL_NAME = "generate_image";
const CODEX_PROVIDER = "openai-codex";
const CODEX_MODEL_PREFERENCES = ["gpt-5.5", "gpt-5.5-fast"] as const;
const ASPECT_RATIO_VALUES = ["square", "1:1", "portrait", "2:3", "landscape", "3:2", "16:9", "9:16"] as const;
const QUALITY_VALUES = ["auto", "low", "medium", "high"] as const;

const GenerateImageSchema = Type.Object({
	prompt: Type.String({
		description: "Exact image generation/editing prompt to send to GPT Image 2.",
	}),
	inputImages: Type.Optional(Type.Array(Type.String({
		description: "Local PNG, JPEG, or WebP file path. Relative paths resolve against the current working directory; ~ and absolute paths are supported.",
	}), {
		description: "Optional local image/reference/edit inputs. Max 5 files, 50MB each.",
		maxItems: MAX_INPUT_IMAGES,
	})),
	aspectRatio: Type.Optional(StringEnum([...ASPECT_RATIO_VALUES], {
		description: "Optional aspect-ratio shorthand. Do not provide together with size.",
	})),
	size: Type.Optional(Type.String({
		description: "Optional GPT Image 2 size: auto or WIDTHxHEIGHT. Dimensions must be multiples of 16, max edge <= 3840, ratio <= 3:1, and 655,360–8,294,400 total pixels. Do not provide together with aspectRatio.",
	})),
	quality: Type.Optional(StringEnum([...QUALITY_VALUES], {
		description: "Optional quality. Defaults to auto; use low for drafts and high for final/text-heavy/identity-sensitive images.",
	})),
	basename: Type.Optional(Type.String({
		description: "Optional short filename slug. It is sanitized and combined with timestamp/counter; arbitrary output paths are not supported.",
	})),
	count: Type.Optional(Type.Integer({
		description: "Number of images to generate from the same prompt/options. Defaults to 1; must be an integer from 1 to 4.",
		minimum: 1,
		maximum: MAX_COUNT,
	})),
}, { additionalProperties: false });

type GenerateImageToolParams = Static<typeof GenerateImageSchema>;

export default function painterExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Generate Image",
		description: "Generate or edit images with GPT Image 2 using existing openai-codex/ChatGPT OAuth credentials. Returns inline images and saves artifacts globally.",
		promptSnippet: "Generate or edit images with GPT Image 2; returns inline images and saves them globally",
		promptGuidelines: [
			"Use generate_image when the user explicitly asks to generate, create, paint, edit, or transform an image.",
			"Ask a clarifying question only when necessary visual details or edit intent are missing.",
			"Preserve explicit style/content constraints. For edits, do not silently change the user's requested subject, identity, or transformation.",
		],
		parameters: GenerateImageSchema,
		executionMode: "sequential",

		async execute(_toolCallId: string, params: GenerateImageToolParams, signal: AbortSignal | undefined, onUpdate: ((result: { content: TextContent[]; details: GenerateImageDetails }) => void) | undefined, ctx: ExtensionContext) {
			onUpdate?.({
				content: [textContent("Validating image generation inputs...")],
				details: { status: "validating" },
			});

			try {
				const options = normalizeImageOptions(params as GenerateImageParams);
				const inputImages = await readAndValidateInputImages(ctx.cwd, params.inputImages);
				const endpointType = inputImages.length > 0 ? "edit" : "generation";

				onUpdate?.({
					content: [textContent("Requesting GPT Image 2...")],
					details: {
						status: "requesting",
						endpointType,
						requestedCount: options.count,
						options: summarizeOptions(options),
					},
				});

				const auth = await resolveCodexAuth(ctx);
				const clientResult = await callDirectImageEndpoint({
					token: auth.token,
					authHeaders: auth.headers,
					model: auth.model.id,
					prompt: options.prompt,
					inputImages,
					count: options.count,
					quality: options.quality,
					background: options.background,
					size: options.size,
					signal,
				});

				onUpdate?.({
					content: [textContent("Saving generated image artifacts...")],
					details: {
						status: "saving",
						endpointType: clientResult.endpointType,
						requestedCount: options.count,
						generatedCount: clientResult.images.length,
						warnings: clientResult.warnings,
						requestId: clientResult.requestId,
						responseId: clientResult.responseId,
						retryCount: clientResult.retryCount,
						options: summarizeOptions(options),
					},
				});

				const artifacts = await saveGeneratedImageArtifacts({
					images: clientResult.images,
					options,
					inputImages,
					clientResult,
				});

				const details: GenerateImageDetails = {
					status: "done",
					endpointType: clientResult.endpointType,
					requestedCount: options.count,
					generatedCount: clientResult.images.length,
					warnings: clientResult.warnings,
					options: summarizeOptions(options),
					artifactsDir: artifacts.artifactsDir,
					images: artifacts.images,
					requestId: clientResult.requestId,
					responseId: clientResult.responseId,
					retryCount: clientResult.retryCount,
				};

				onUpdate?.({
					content: [textContent("Generated image artifacts saved.")],
					details,
				});

				return {
					content: [
						textContent(formatResultSummary(artifacts.artifactsDir, artifacts.images, details)),
						...clientResult.images.map((image) => imageContent(image.base64, image.mime)),
					],
					details,
				};
			} catch (error) {
				const message = formatSafeError(error);
				onUpdate?.({
					content: [textContent(`Image generation failed: ${message}`)],
					details: { status: "error", error: message },
				});
				throw new Error(message);
			}
		},

		renderCall(args: GenerateImageToolParams, theme: any) {
			const mode = args.inputImages?.length ? "edit" : "generate";
			const count = args.count ?? 1;
			const size = args.aspectRatio ? `aspect ${args.aspectRatio}` : args.size ? `size ${args.size}` : "auto";
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `));
			text += theme.fg("accent", mode);
			text += theme.fg("muted", ` ×${count} ${size}`);
			if (args.quality && args.quality !== "auto") {
				text += theme.fg("muted", ` ${args.quality}`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result: { content: Array<{ type: string; text?: string }>; details?: GenerateImageDetails; isError?: boolean }, options: { expanded: boolean; isPartial: boolean }, theme: any) {
			const details = result.details;
			if (options.isPartial) {
				const status = details?.status ? progressLabel(details.status) : "Generating image...";
				return new Text(theme.fg("warning", status), 0, 0);
			}
			if (result.isError) {
				return new Text(theme.fg("error", `✗ ${getTextContent(result.content) || "Image generation failed"}`), 0, 0);
			}

			let text = theme.fg("success", `✓ Generated ${details?.generatedCount ?? details?.images?.length ?? ""} image(s)`.replace("  ", " "));
			if (details?.options?.size) text += theme.fg("muted", ` ${details.options.size}`);
			if (details?.options?.quality) text += theme.fg("muted", ` ${details.options.quality}`);
			if (details?.warnings?.length) text += theme.fg("warning", ` (${details.warnings.length} warning${details.warnings.length === 1 ? "" : "s"})`);
			if (options.expanded && details?.images?.length) {
				for (const image of details.images) {
					text += `\n${theme.fg("dim", `${image.path} (${image.mime}, ${formatSize(image.byteSize)})`)}`;
				}
				if (details.artifactsDir) text += `\n${theme.fg("dim", `Artifacts: ${details.artifactsDir}`)}`;
			}
			return new Text(text, 0, 0);
		},
	});
}

interface ResolvedCodexAuth {
	token: string;
	headers?: Record<string, string>;
	model: Model<Api>;
}

async function resolveCodexAuth(ctx: ExtensionContext): Promise<ResolvedCodexAuth> {
	const candidates = getCodexAuthCandidates(ctx);
	if (candidates.length === 0) {
		throw new Error("No openai-codex model is configured. Configure/login to openai-codex/ChatGPT OAuth outside the generate_image tool.");
	}

	let lastError = "No usable openai-codex auth found.";
	for (const model of candidates) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (auth.ok && auth.apiKey?.trim()) {
			return { token: auth.apiKey, headers: auth.headers, model };
		}
		lastError = auth.ok ? `No OAuth token returned for ${model.provider}/${model.id}.` : auth.error;
	}

	throw new Error(`${lastError} Refresh/open openai-codex/ChatGPT OAuth credentials outside the generate_image tool.`);
}

function getCodexAuthCandidates(ctx: ExtensionContext): Model<Api>[] {
	const candidates: Model<Api>[] = [];
	const seen = new Set<string>();
	const add = (model: Model<Api> | undefined) => {
		if (!model || model.provider !== CODEX_PROVIDER) return;
		const key = `${model.provider}/${model.id}`;
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push(model);
	};

	for (const modelId of CODEX_MODEL_PREFERENCES) {
		add(ctx.modelRegistry.find(CODEX_PROVIDER, modelId));
	}
	for (const model of ctx.modelRegistry.getAll()) {
		add(model);
	}
	return candidates;
}

function summarizeOptions(options: { size: string; quality: ImageQuality; background: "auto"; count: number; aspectRatio?: string }) {
	return {
		size: options.size,
		quality: options.quality,
		background: options.background,
		count: options.count,
		aspectRatio: options.aspectRatio,
	};
}

function formatResultSummary(artifactsDir: string, images: SavedGeneratedImage[], details: GenerateImageDetails): string {
	const lines = [
		`Generated ${images.length} image${images.length === 1 ? "" : "s"} with ${IMAGE_MODEL}${details.endpointType ? ` (${details.endpointType})` : ""}.`,
		`Artifacts: ${artifactsDir}`,
	];
	for (const image of images) {
		lines.push(`- ${image.path} (${image.mime}, ${formatSize(image.byteSize)}, sha256 ${image.sha256.slice(0, 12)}…)`);
	}
	if (details.warnings?.length) {
		lines.push("Warnings:");
		for (const warning of details.warnings) lines.push(`- ${warning}`);
	}
	return lines.join("\n");
}

function formatSafeError(error: unknown): string {
	if (error instanceof DirectImageEndpointError) return error.message;
	return error instanceof Error ? error.message : String(error);
}

function progressLabel(status: GenerateImageDetails["status"]): string {
	switch (status) {
		case "validating": return "Validating image inputs...";
		case "requesting": return "Requesting GPT Image 2...";
		case "saving": return "Saving generated image artifacts...";
		case "done": return "Image generation complete.";
		case "error": return "Image generation failed.";
	}
}

function getTextContent(content: Array<{ type: string; text?: string }>): string {
	return content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

function textContent(text: string): TextContent {
	return { type: "text", text };
}

function imageContent(data: string, mimeType: string): ImageContent {
	return { type: "image", data, mimeType };
}
