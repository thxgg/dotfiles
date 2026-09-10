/** Bound traversal before serialization, including cyclic or very wide tool details. */
export function detailPreview(value: unknown, maxChars = 8_000): string {
  let budget = maxChars;
  let nodes = 200;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (--nodes < 0 || budget <= 0 || depth > 6) return "[preview limit]";
    budget -= 16;
    if (typeof item === "string") {
      const part = item.slice(0, Math.max(0, Math.min(budget, 2_000)));
      budget -= part.length;
      return part.length < item.length ? `${part}…` : part;
    }
    if (item === null || typeof item === "boolean" || typeof item === "number") return item;
    if (typeof item !== "object") return String(item);
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    if (Array.isArray(item)) return item.slice(0, 30).map(child => visit(child, depth + 1));
    const output: Record<string, unknown> = Object.create(null);
    let keys = 0;
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      if (++keys > 30 || budget <= 0 || nodes <= 0) { output["…"] = "[preview limit]"; break; }
      budget -= key.length;
      const child = (item as Record<string, unknown>)[key];
      output[key.slice(0, 100)] = key === "data" && typeof child === "string" && child.length > 1_000
        ? "[binary data omitted]" : visit(child, depth + 1);
    }
    return output;
  };
  try { return JSON.stringify(visit(value, 0), null, 2).slice(0, maxChars); }
  catch { return "[Details preview unavailable; use normal rendering]"; }
}
