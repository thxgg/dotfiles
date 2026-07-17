import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let output = value.slice(0, maxBytes);
  while (Buffer.byteLength(output, "utf8") > maxBytes) output = output.slice(0, -1);
  return output;
}

export function toSerializable(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[depth limit]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.slice(0, 10_000).map((item) => toSerializable(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value).slice(0, 10_000)) {
      if (!["__proto__", "constructor", "prototype"].includes(key)) output[key] = toSerializable(item, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function safeStringify(value: unknown, maxBytes = 1024 * 1024): string {
  const text = JSON.stringify(toSerializable(value), null, 2);
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`Serialized value exceeds ${maxBytes} bytes.`);
  return text;
}

export function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try { fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" }); fs.renameSync(temp, filePath); }
  finally { try { fs.unlinkSync(temp); } catch { /* renamed */ } }
}
