import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

export interface OutputSettings {
	readonly retentionDays: number;
	readonly maxBytes: number;
	readonly maxLines: number;
}

/** Invalid settings use defaults. Explicit options take precedence over environment settings. */
export function getOutputSettings(
	env: Readonly<Record<string, string | undefined>> = process.env,
	options: Partial<OutputSettings> = {},
): OutputSettings {
	return {
		retentionDays: boundedInteger(options.retentionDays ?? env.PI_WEB_TOOLS_OUTPUT_RETENTION_DAYS, 1, 365, 7),
		maxBytes: boundedInteger(options.maxBytes ?? env.PI_WEB_TOOLS_OUTPUT_MAX_BYTES, 1024, 51200, DEFAULT_MAX_BYTES),
		maxLines: boundedInteger(options.maxLines ?? env.PI_WEB_TOOLS_OUTPUT_MAX_LINES, 1, 2000, DEFAULT_MAX_LINES),
	};
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value === "string" && !/^\d+$/.test(value.trim())) return fallback;
	const number = typeof value === "string" ? Number(value.trim()) : value;
	return typeof number === "number" && Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}
