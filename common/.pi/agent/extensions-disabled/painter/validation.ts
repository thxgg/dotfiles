import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
	MAX_COUNT,
	MAX_INPUT_IMAGE_BYTES,
	MAX_INPUT_IMAGES,
	type ImageQuality,
	type NormalizedImageOptions,
	type PreparedInputImage,
	type SupportedImageMime,
} from "./types.ts";

const QUALITY_VALUES = new Set<ImageQuality>(["auto", "low", "medium", "high"]);
const ASPECT_RATIO_SIZE_MAP = new Map<string, string>([
	["square", "1024x1024"],
	["1:1", "1024x1024"],
	["portrait", "1024x1536"],
	["2:3", "1024x1536"],
	["landscape", "1536x1024"],
	["3:2", "1536x1024"],
	["16:9", "1536x864"],
	["9:16", "864x1536"],
]);

export interface GenerateImageParams {
	prompt: string;
	inputImages?: string[];
	aspectRatio?: string;
	size?: string;
	quality?: ImageQuality;
	basename?: string;
	count?: number;
}

export function normalizeImageOptions(params: GenerateImageParams): NormalizedImageOptions {
	if (typeof params.prompt !== "string" || params.prompt.trim().length === 0) {
		throw new Error("prompt is required and must be a non-empty string.");
	}

	const count = validateCount(params.count);
	const quality = validateQuality(params.quality);
	const { size, requestedSize, aspectRatio } = normalizeRequestedSize(params.size, params.aspectRatio);
	const basename = sanitizeBasename(params.basename);

	return {
		prompt: params.prompt,
		count,
		quality,
		background: "auto",
		size,
		requestedSize,
		aspectRatio,
		basename,
	};
}

export function validateCount(value: unknown): number {
	if (value === undefined || value === null) return 1;
	if (!Number.isInteger(value)) {
		throw new Error(`count must be an integer from 1 to ${MAX_COUNT}.`);
	}
	const count = value as number;
	if (count < 1 || count > MAX_COUNT) {
		throw new Error(`count must be an integer from 1 to ${MAX_COUNT}; make multiple calls if more variants are needed.`);
	}
	return count;
}

export function validateQuality(value: unknown): ImageQuality {
	if (value === undefined || value === null || value === "") return "auto";
	if (typeof value !== "string") {
		throw new Error("quality must be one of: auto, low, medium, high.");
	}
	const normalized = value.trim().toLowerCase() as ImageQuality;
	if (!QUALITY_VALUES.has(normalized)) {
		throw new Error("quality must be one of: auto, low, medium, high.");
	}
	return normalized;
}

export function normalizeRequestedSize(size: unknown, aspectRatio: unknown): {
	size: string;
	requestedSize?: string;
	aspectRatio?: string;
} {
	const hasSize = typeof size === "string" && size.trim().length > 0;
	const hasAspectRatio = typeof aspectRatio === "string" && aspectRatio.trim().length > 0;

	if (hasSize && hasAspectRatio) {
		throw new Error("Specify either size or aspectRatio, not both.");
	}

	if (hasAspectRatio) {
		const normalizedAspectRatio = (aspectRatio as string).trim().toLowerCase();
		const mappedSize = ASPECT_RATIO_SIZE_MAP.get(normalizedAspectRatio);
		if (!mappedSize) {
			throw new Error("aspectRatio must be one of: square, 1:1, portrait, 2:3, landscape, 3:2, 16:9, 9:16.");
		}
		return { size: mappedSize, aspectRatio: normalizedAspectRatio };
	}

	if (!hasSize) {
		return { size: "auto" };
	}

	const normalizedSize = (size as string).trim().toLowerCase();
	if (normalizedSize === "auto") {
		return { size: "auto", requestedSize: normalizedSize };
	}

	validateExplicitSize(normalizedSize);
	return { size: normalizedSize, requestedSize: normalizedSize };
}

export function validateExplicitSize(size: string): void {
	const match = /^(\d{2,5})x(\d{2,5})$/.exec(size);
	if (!match) {
		throw new Error("size must be auto or WIDTHxHEIGHT, for example 1024x1024.");
	}

	const width = Number.parseInt(match[1]!, 10);
	const height = Number.parseInt(match[2]!, 10);
	const longEdge = Math.max(width, height);
	const shortEdge = Math.min(width, height);
	const pixels = width * height;

	if (width % 16 !== 0 || height % 16 !== 0) {
		throw new Error("size dimensions must both be multiples of 16.");
	}
	if (longEdge > 3840) {
		throw new Error("size max edge must be <= 3840 pixels.");
	}
	if (longEdge / shortEdge > 3) {
		throw new Error("size long:short aspect ratio must be <= 3:1.");
	}
	if (pixels < 655_360 || pixels > 8_294_400) {
		throw new Error("size total pixels must be between 655,360 and 8,294,400.");
	}
}

export function sanitizeBasename(value: unknown): string {
	if (typeof value !== "string") return "image";
	const slug = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/[-_]{2,}/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "")
		.slice(0, 48)
		.replace(/^[-_]+|[-_]+$/g, "");
	return slug || "image";
}

export function resolveInputImagePath(cwd: string, inputPath: string): string {
	if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
		throw new Error("inputImages entries must be non-empty local file paths.");
	}
	const expanded = inputPath.startsWith("~/") || inputPath === "~" ? `${homedir()}${inputPath.slice(1)}` : inputPath;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

export function detectSupportedInputMime(bytes: Buffer): SupportedImageMime | undefined {
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
	return undefined;
}

export async function readAndValidateInputImages(cwd: string, inputImages: string[] | undefined): Promise<PreparedInputImage[]> {
	if (inputImages === undefined || inputImages.length === 0) return [];
	if (!Array.isArray(inputImages)) {
		throw new Error("inputImages must be an array of local file paths.");
	}
	if (inputImages.length > MAX_INPUT_IMAGES) {
		throw new Error(`inputImages supports at most ${MAX_INPUT_IMAGES} files; received ${inputImages.length}.`);
	}

	const prepared: PreparedInputImage[] = [];
	for (const suppliedPath of inputImages) {
		const resolvedPath = resolveInputImagePath(cwd, suppliedPath);
		const stats = await stat(resolvedPath);
		if (!stats.isFile()) {
			throw new Error(`input image is not a regular file: ${suppliedPath}`);
		}
		if (stats.size > MAX_INPUT_IMAGE_BYTES) {
			throw new Error(`input image exceeds 50MB limit: ${suppliedPath}`);
		}

		const bytes = await readFile(resolvedPath);
		const mime = detectSupportedInputMime(bytes);
		if (!mime) {
			throw new Error(`unsupported input image format for ${suppliedPath}; supported formats are PNG, JPEG, and WebP.`);
		}

		prepared.push({
			suppliedPath,
			resolvedPath,
			mime,
			byteSize: bytes.length,
			dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
		});
	}

	return prepared;
}
