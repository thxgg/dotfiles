export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  byteSize: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function validateArtifactHtml(html: string, runtimeMode: "static" | "interactive" = "static"): ValidationReport {
  const byteSize = Buffer.byteLength(html, "utf8");
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string) => issues.push({ code, severity: "error", message });
  const warning = (code: string, message: string) => issues.push({ code, severity: "warning", message });

  if (byteSize > MAX_SOURCE_BYTES) error("source-too-large", `Source is ${formatBytes(byteSize)}; the publish limit is ${formatBytes(MAX_SOURCE_BYTES)}.`);
  if (/<script\b/i.test(html)) error("scripts-disabled", runtimeMode === "interactive" ? "Artifact-authored scripts are disabled; use declarative data-artifact-* behaviors." : "Scripts are disabled; remove every <script> element.");
  if (/\son[a-z]+\s*=/i.test(html)) error("inline-handler", "Inline event-handler attributes are disabled; attach listeners from an inline script instead.");
  if (/<(?:iframe|object|embed)\b/i.test(html)) error("embedded-content", "Embedded browsing and plugin content is not allowed.");
  if (/<form\b/i.test(html)) error("forms-disabled", "Forms are disabled for all artifacts.");
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/i.test(html)) error("meta-refresh", "Meta refresh navigation is not allowed.");

  if (runtimeMode === "interactive") {
    for (const link of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)) {
      if (!isEmbeddedReference(link[2] ?? "")) error("interactive-navigation", `Interactive artifact links must stay within the document; found ${summarize(link[2] ?? "")}.`);
    }
  }
  for (const reference of resourceReferences(html)) {
    if (!isEmbeddedReference(reference.value)) {
      error("external-resource", `${reference.element} ${reference.attribute} must be embedded; found ${summarize(reference.value)}.`);
    }
  }
  for (const value of cssReferences(html)) {
    if (!isEmbeddedReference(value)) error("external-css-resource", `CSS resources must be embedded; found ${summarize(value)}.`);
  }
  if (/@import\b/i.test(cssSource(html))) error("css-import", "CSS @import dependencies are not allowed.");

  if (!/^\s*<!doctype\s+html\b/i.test(html)) warning("missing-doctype", "Add <!doctype html> for standards-mode rendering.");
  if (!/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html)) warning("missing-lang", "Set the document language on <html lang=\"…\">.");
  if (!/<meta\b[^>]*charset\s*=/i.test(html)) warning("missing-charset", "Declare <meta charset=\"utf-8\">.");
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html)) warning("missing-viewport", "Add a responsive viewport meta tag.");
  if (!/<title\b[^>]*>\s*[^<\s][\s\S]*?<\/title>/i.test(html)) warning("missing-title", "Add a descriptive document title.");
  if (!/<main\b/i.test(html)) warning("missing-main", "Use a <main> landmark for primary content.");
  if (!/<h1\b/i.test(html)) warning("missing-h1", "Include one clear top-level heading.");

  for (const image of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (!/\balt\s*=\s*["'][^"']*["']/i.test(image[1] ?? "")) warning("image-alt", "Every image needs an alt attribute (empty for decorative images).");
  }
  for (const button of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    if (!hasAccessibleControlName("button", button[1] ?? "", button[2] ?? "", html)) warning("control-name", "A <button> control may not have an accessible name.");
  }
  for (const control of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const element = control[1]!.toLowerCase();
    const attributes = control[2] ?? "";
    if (/\bdisabled\b/i.test(attributes)) continue;
    if (!hasAccessibleControlName(element, attributes, "", html)) warning("control-name", `A <${element}> control may not have an accessible name.`);
  }

  const css = cssSource(html);
  if (/(?:animation|transition)\s*:/i.test(css) && !/@media\s*\([^)]*prefers-reduced-motion\s*:\s*reduce/i.test(css)) {
    warning("reduced-motion", "Animations or transitions should include a prefers-reduced-motion fallback.");
  }
  if (!/@media\s+print\b/i.test(css)) warning("print-style", "Consider a print stylesheet for reports and explainers.");
  if (runtimeMode === "interactive" && !/\bdata-artifact-(?:increment|toggle|show|filter)\b/i.test(html)) warning("interactive-without-behavior", "runtimeMode is interactive but the document declares no supported data-artifact-* behavior.");

  const unique = deduplicateIssues(issues);
  const errors = unique.filter((issue) => issue.severity === "error");
  return { valid: errors.length === 0, byteSize, errors, warnings: unique.filter((issue) => issue.severity === "warning") };
}

export function formatValidationReport(report: ValidationReport): string {
  const lines = [`Validation ${report.valid ? "passed" : "failed"} · ${formatBytes(report.byteSize)} · ${report.errors.length} errors · ${report.warnings.length} warnings`];
  for (const issue of [...report.errors, ...report.warnings]) lines.push(`- ${issue.severity.toUpperCase()} [${issue.code}] ${issue.message}`);
  return lines.join("\n");
}

function resourceReferences(html: string): Array<{ element: string; attribute: string; value: string }> {
  const references: Array<{ element: string; attribute: string; value: string }> = [];
  const elements = /<(img|source|video|audio|track|link)\b([^>]*)>/gi;
  for (const match of html.matchAll(elements)) {
    const element = match[1]!.toLowerCase();
    const attributes = match[2] ?? "";
    if (element === "link" && !/\brel\s*=\s*["'][^"']*(?:stylesheet|icon|preload|modulepreload)[^"']*["']/i.test(attributes)) continue;
    for (const attribute of ["src", "srcset", "poster", "href"]) {
      const value = new RegExp(`\\b${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attributes)?.[2];
      if (!value) continue;
      for (const candidate of attribute === "srcset" ? value.split(",").map((part) => part.trim().split(/\s+/)[0]!) : [value]) {
        references.push({ element: `<${element}>`, attribute, value: candidate });
      }
    }
  }
  return references;
}

function cssReferences(html: string): string[] {
  const values: string[] = [];
  for (const match of cssSource(html).matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) values.push(match[2]!.trim());
  return values;
}

function cssSource(html: string): string {
  const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
  const inline = [...html.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map((match) => match[2]);
  return [...blocks, ...inline].join("\n");
}

function isEmbeddedReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("data:") || normalized.startsWith("#") || normalized === "";
}

function hasAccessibleControlName(element: string, attributes: string, content: string, html: string): boolean {
  if (/\b(?:aria-label|aria-labelledby|title)\s*=\s*["'][^"']+["']/i.test(attributes)) return true;
  if (element === "button") return content.replace(/<[^>]+>/g, "").trim().length > 0;
  if (element === "input" && /\btype\s*=\s*["'](?:hidden|submit|button|reset)["']/i.test(attributes)) return true;
  const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
  return Boolean(id && new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${escapeRegex(id)}["']`, "i").test(html));
}

function deduplicateIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.code}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarize(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return JSON.stringify(compact.length > 80 ? `${compact.slice(0, 77)}…` : compact);
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function formatBytes(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
