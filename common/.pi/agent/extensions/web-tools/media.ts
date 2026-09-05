export type SupportedRasterMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** Identify file signatures, not full image validity. Keep Pi's raster allowlist explicit. */
export function detectMediaSignature(bytes: Buffer):
	| { readonly kind: "raster-image"; readonly mime: SupportedRasterMime }
	| { readonly kind: "binary"; readonly mime: "image/bmp" | "application/pdf" }
	| undefined {
	if (startsWith(bytes, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return { kind: "raster-image", mime: "image/png" };
	}
	if (startsWith(bytes, Buffer.from([0xff, 0xd8, 0xff]))) {
		return { kind: "raster-image", mime: "image/jpeg" };
	}
	if (startsWith(bytes, Buffer.from("GIF87a")) || startsWith(bytes, Buffer.from("GIF89a"))) {
		return { kind: "raster-image", mime: "image/gif" };
	}
	if (bytes.length >= 16 && bytes.toString("latin1", 0, 4) === "RIFF"
		&& bytes.toString("latin1", 8, 12) === "WEBP"
		&& ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("latin1", 12, 16))) {
		return { kind: "raster-image", mime: "image/webp" };
	}
	if (hasPlausibleBmpHeader(bytes)) return { kind: "binary", mime: "image/bmp" };
	if (startsWith(bytes, Buffer.from("%PDF-"))) return { kind: "binary", mime: "application/pdf" };
	return undefined;
}

/** Check the file and DIB headers without decoding pixels. "BM" alone is ordinary text. */
function hasPlausibleBmpHeader(bytes: Buffer): boolean {
	if (bytes.length < 26 || !startsWith(bytes, Buffer.from("BM"))) return false;
	const fileSize = bytes.readUInt32LE(2);
	const pixelOffset = bytes.readUInt32LE(10);
	const dibSize = bytes.readUInt32LE(14);
	if (![12, 40, 52, 56, 64, 108, 124].includes(dibSize)
		|| bytes.length < 14 + dibSize || bytes.readUInt32LE(6) !== 0
		|| pixelOffset < 14 + dibSize || pixelOffset >= fileSize || fileSize > bytes.length) return false;

	const core = dibSize === 12;
	const width = core ? bytes.readUInt16LE(18) : bytes.readInt32LE(18);
	const height = core ? bytes.readUInt16LE(20) : bytes.readInt32LE(22);
	const planes = bytes.readUInt16LE(core ? 22 : 26);
	const bitDepth = bytes.readUInt16LE(core ? 24 : 28);
	return width > 0 && height !== 0 && planes === 1 && [1, 2, 4, 8, 16, 24, 32].includes(bitDepth);
}

function startsWith(bytes: Buffer, signature: Buffer): boolean {
	return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}
