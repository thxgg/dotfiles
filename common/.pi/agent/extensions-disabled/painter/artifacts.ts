import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	IMAGE_MODEL,
	type DirectImageClientResult,
	type GeneratedImage,
	type NormalizedImageOptions,
	type PreparedInputImage,
	type SavedGeneratedImage,
} from "./types.ts";

export interface SaveArtifactsRequest {
	images: GeneratedImage[];
	options: NormalizedImageOptions;
	inputImages: PreparedInputImage[];
	clientResult: DirectImageClientResult;
	now?: Date;
}

export interface SaveArtifactsResult {
	artifactsDir: string;
	images: SavedGeneratedImage[];
}

export async function saveGeneratedImageArtifacts(request: SaveArtifactsRequest): Promise<SaveArtifactsResult> {
	const now = request.now ?? new Date();
	const artifactsDir = getArtifactDateDir(now);
	await mkdir(artifactsDir, { recursive: true });

	const saved: SavedGeneratedImage[] = [];
	let counter = 1;
	for (const image of request.images) {
		const artifactPaths = await nextArtifactPaths(artifactsDir, request.options.basename, formatTime(now), image.extension, counter);
		counter = artifactPaths.nextCounter;
		await writeFile(artifactPaths.imagePath, image.bytes);
		const sha256 = sha256Hex(image.bytes);
		const sidecar = buildSidecarMetadata({
			image,
			imagePath: artifactPaths.imagePath,
			metadataPath: artifactPaths.metadataPath,
			sha256,
			options: request.options,
			inputImages: request.inputImages,
			clientResult: request.clientResult,
			now,
		});
		await writeFile(artifactPaths.metadataPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
		saved.push({
			index: image.index,
			path: artifactPaths.imagePath,
			metadataPath: artifactPaths.metadataPath,
			mime: image.mime,
			byteSize: image.bytes.length,
			sha256,
			revisedPrompt: image.revisedPrompt,
			outputFormat: image.outputFormat,
		});
	}

	return { artifactsDir, images: saved };
}

export function getArtifactBaseDir(): string {
	const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
	const dataHome = xdgDataHome || join(homedir(), ".local", "share");
	return join(dataHome, "pi", "generated-images");
}

export function getArtifactDateDir(date = new Date()): string {
	return join(getArtifactBaseDir(), formatDate(date));
}

export function buildSidecarMetadata(params: {
	image: GeneratedImage;
	imagePath: string;
	metadataPath: string;
	sha256: string;
	options: NormalizedImageOptions;
	inputImages: PreparedInputImage[];
	clientResult: DirectImageClientResult;
	now: Date;
}): Record<string, unknown> {
	return {
		version: 1,
		timestamp: params.now.toISOString(),
		model: IMAGE_MODEL,
		endpointType: params.clientResult.endpointType,
		prompt: params.options.prompt,
		revisedPrompt: params.image.revisedPrompt,
		options: {
			count: params.options.count,
			quality: params.options.quality,
			background: params.options.background,
			size: params.options.size,
			requestedSize: params.options.requestedSize,
			aspectRatio: params.options.aspectRatio,
			basename: params.options.basename,
		},
		request: {
			id: params.clientResult.requestId,
		},
		response: {
			id: params.clientResult.responseId,
			created: params.clientResult.created,
			metadata: params.clientResult.responseMetadata,
		},
		generatedFile: {
			index: params.image.index,
			path: params.imagePath,
			metadataPath: params.metadataPath,
			mime: params.image.mime,
			byteSize: params.image.bytes.length,
			sha256: params.sha256,
			outputFormat: params.image.outputFormat,
			metadata: params.image.metadata,
		},
		inputImages: params.inputImages.map((image, index) => ({
			index: index + 1,
			suppliedPath: image.suppliedPath,
			resolvedPath: image.resolvedPath,
			mime: image.mime,
			byteSize: image.byteSize,
		})),
		warnings: params.clientResult.warnings,
	};
}

export function sha256Hex(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function formatTime(date: Date): string {
	return `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

async function nextArtifactPaths(dir: string, basename: string, time: string, extension: string, startCounter: number): Promise<{
	imagePath: string;
	metadataPath: string;
	nextCounter: number;
}> {
	let counter = startCounter;
	while (true) {
		const stem = `${basename}-${time}-${counter}`;
		const imagePath = join(dir, `${stem}.${extension}`);
		const metadataPath = join(dir, `${stem}.json`);
		if (!(await pathExists(imagePath)) && !(await pathExists(metadataPath))) {
			return { imagePath, metadataPath, nextCounter: counter + 1 };
		}
		counter += 1;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}
