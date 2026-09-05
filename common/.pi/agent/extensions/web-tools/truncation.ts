import {
	formatSize,
	type TruncationResult,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { OutputFiles, type OutputFileOptions } from "./temp.ts";

export interface TruncatedTextOutput {
	text: string;
	truncated: boolean;
	fullOutputPath?: string;
	truncation: TruncationResult;
}

export async function truncateTextOutput(
	output: string,
	options: {
		maxBytes?: number;
		maxLines?: number;
		tempPrefix: string;
		fileName?: string;
		storeOptions?: OutputFileOptions;
	},
): Promise<TruncatedTextOutput> {
	const files = new OutputFiles({
		...options.storeOptions,
		maxBytes: options.maxBytes ?? options.storeOptions?.maxBytes,
		maxLines: options.maxLines ?? options.storeOptions?.maxLines,
	});
	const truncation = truncateHead(output, files.settings);

	if (!truncation.truncated) {
		return {
			text: truncation.content,
			truncated: false,
			truncation,
		};
	}

	const fullOutputPath = await files.write(options.tempPrefix, options.fileName ?? "output.txt", output);
	const omittedLines = truncation.totalLines - truncation.outputLines;
	const omittedBytes = truncation.totalBytes - truncation.outputBytes;
	let text = truncation.content;
	text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
	text += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
	text += ` ${omittedLines} lines (${formatSize(omittedBytes)}) omitted.`;
	text += ` Full output saved to: ${fullOutputPath} (eligible for cleanup after ${files.settings.retentionDays} days).]`;

	return {
		text,
		truncated: true,
		fullOutputPath,
		truncation,
	};
}
