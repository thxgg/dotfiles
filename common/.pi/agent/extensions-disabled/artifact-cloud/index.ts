import { readFile, realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum, type TextContent } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { apiRequest, copyUrlToClipboard, loadArtifactConfig, resolveArtifactIdentifier, resolveLocalPath, type ArtifactConfig, type ArtifactRecord } from "./client.ts";
import { getRegistryEntry, setRegistryEntry } from "./registry.ts";
import { formatValidationReport, validateArtifactHtml, type ValidationReport } from "./validation.ts";

const executeFile = promisify(execFile);
const actions = ["validate", "publish", "update", "list", "get", "open", "archive", "unarchive", "delete"] as const;

const ArtifactSchema = Type.Object({
  action: StringEnum([...actions], { description: "Validate, publish, update, list, inspect, open, archive, restore, or permanently delete an artifact." }),
  path: Type.Optional(Type.String({ description: "Local HTML file. Required for validate/publish/update. Relative paths resolve from the current working directory." })),
  artifactId: Type.Optional(Type.String({ description: "Artifact ID, slug, canonical viewer URL, or API URL. Required for get/archive/unarchive/delete, or update without a registry mapping." })),
  title: Type.Optional(Type.String({ description: "Title for a new artifact. Defaults to the HTML title or filename." })),
  description: Type.Optional(Type.String({ description: "Short gallery description for a new artifact." })),
  slug: Type.Optional(Type.String({ description: "Optional stable human-readable slug for a new artifact." })),
  tags: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })),
  runtimeMode: Type.Optional(StringEnum(["static", "interactive"], { description: "Execution policy. Defaults to static. Interactive enables trusted declarative data-artifact-* behaviors in an opaque-origin sandbox." })),
  query: Type.Optional(Type.String({ description: "Search text for list." })),
  tag: Type.Optional(Type.String({ description: "Tag filter for list." })),
  includeArchived: Type.Optional(Type.Boolean({ description: "Include archived artifacts in list results." })),
  copyUrl: Type.Optional(Type.Boolean({ description: "Copy the canonical viewer URL to Universal Clipboard after publish, update, or open." })),
  openOnComplete: Type.Optional(Type.Boolean({ description: "Open the canonical viewer after publish/update. Defaults to true; set false for background workflows." })),
  confirmArtifactId: Type.Optional(Type.String({ description: "Exact artifact UUID required to confirm permanent deletion." })),
}, { additionalProperties: false });

type ArtifactParams = Static<typeof ArtifactSchema>;

export default function artifactCloudExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "artifact",
    label: "Artifact",
    description: "Validate and publish self-contained HTML files to the personal tailnet artifact cloud, update stable artifact URLs, inspect artifacts, or manage archival lifecycle. Publishing rejects scripts and external dependencies locally before upload.",
    promptSnippet: "Publish or update self-contained HTML files in the personal artifact cloud",
    promptGuidelines: [
      "Use artifact when visual or interactive HTML communicates the result better than terminal text and the user wants it published.",
      "Keep artifact HTML self-contained. Static is the default; use runtimeMode=interactive only when essential inline interaction has been security-tested.",
      "Interactive artifacts use only supported data-artifact-* attributes; authored scripts, handlers, forms, frames, external dependencies, navigation, workers, and network access remain blocked.",
      "Use semantic HTML with a language, title, viewport, main landmark, clear heading, accessible control names, image alt text, print styles, and reduced-motion fallbacks.",
      "Before publishing important artifacts, validate and inspect desktop and mobile rendering; publication validation is not a visual regression test.",
      "Publish and update open the canonical viewer automatically unless openOnComplete is explicitly false.",
      "Use artifact update with the same local path to retain the artifact identity and canonical viewer URL.",
      "Across sessions or machines, target get/update/open/archive by artifact ID, slug, or canonical viewer URL.",
      "Archive before permanent deletion; deletion additionally requires the exact artifact UUID in confirmArtifactId.",
    ],
    parameters: ArtifactSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params: ArtifactParams, signal, onUpdate, ctx: ExtensionContext) {
      onUpdate?.({ content: [text(`Artifact ${params.action} in progress...`)], details: { action: params.action, status: "running" } });
      if (params.action === "validate") return validateLocalArtifact(params, ctx.cwd);
      const config = await loadArtifactConfig();
      if (params.action === "list") {
        const search = new URLSearchParams();
        if (params.query) search.set("q", params.query);
        if (params.tag) search.set("tag", params.tag);
        if (params.includeArchived) search.set("archived", "1");
        const result = await apiRequest<{ artifacts: ArtifactRecord[] }>(config, `/v1/artifacts?${search}`, { signal });
        return resultForList(result.artifacts);
      }
      if (params.action === "get") {
        const identifier = requireIdentifier(params, "get");
        const result = await apiRequest<ArtifactRecord>(config, `/v1/artifacts/${encodeURIComponent(identifier)}`, { signal });
        return resultForArtifact(params.action, result);
      }
      if (params.action === "open") {
        const url = await resolveOpenUrl(config, params, ctx.cwd, signal);
        await openViewer(localViewerUrl(config, url), signal);
        if (params.copyUrl) await copyUrlToClipboard(url);
        const copied = params.copyUrl ? " and copied canonical URL" : "";
        return { content: [text(`Opened${copied}: ${url}`)], details: { action: params.action, status: "done", url, copied: params.copyUrl === true } };
      }
      if (params.action === "archive" || params.action === "unarchive") {
        const identifier = requireIdentifier(params, params.action);
        const result = await apiRequest<ArtifactRecord>(config, `/v1/artifacts/${encodeURIComponent(identifier)}`, {
          method: "PATCH",
          body: JSON.stringify({ archived: params.action === "archive" }),
          signal,
        });
        return resultForArtifact(params.action, result);
      }
      if (params.action === "delete") {
        const identifier = requireIdentifier(params, "delete");
        if (!params.confirmArtifactId) throw new Error("confirmArtifactId with the exact artifact UUID is required for permanent deletion.");
        const current = await apiRequest<ArtifactRecord>(config, `/v1/artifacts/${encodeURIComponent(identifier)}`, { signal });
        if (params.confirmArtifactId !== current.artifact.id) throw new Error("confirmArtifactId does not match the artifact UUID.");
        await apiRequest<void>(config, `/v1/artifacts/${encodeURIComponent(current.artifact.id)}`, {
          method: "DELETE",
          headers: { "x-confirm-artifact-id": params.confirmArtifactId },
          signal,
        });
        return { content: [text(`Permanently deleted: ${current.artifact.title} (${current.artifact.id})`)], details: { action: params.action, status: "done", artifactId: current.artifact.id } };
      }
      if (!params.path) throw new Error(`path is required for ${params.action}.`);
      const resolvedPath = resolveLocalPath(ctx.cwd, params.path);
      const fileStats = await stat(resolvedPath);
      if (!fileStats.isFile()) throw new Error(`Not a regular file: ${params.path}`);
      if (!/\.html?$/i.test(resolvedPath)) throw new Error("Only .html and .htm files are supported.");
      const canonicalPath = await realpath(resolvedPath);
      const content = await readFile(canonicalPath, "utf8");
      const runtimeMode: "static" | "interactive" = params.runtimeMode === "interactive" ? "interactive" : "static";
      const validation = validateArtifactHtml(content, runtimeMode);
      if (!validation.valid) throw new Error(formatValidationReport(validation));
      const provenance = { sourceName: basename(canonicalPath), publisher: "pi" };

      if (params.action === "publish") {
        const result = await apiRequest<ArtifactRecord>(config, "/v1/artifacts", {
          method: "POST",
          body: JSON.stringify({
            title: params.title || extractTitle(content) || basename(canonicalPath).replace(/\.html?$/i, ""),
            description: params.description || "",
            slug: params.slug,
            tags: params.tags || [],
            content,
            sourceName: basename(canonicalPath),
            provenance,
            runtimeMode,
          }),
          signal,
        });
        await remember(canonicalPath, result);
        if (params.copyUrl) await copyUrlToClipboard(result.urls.viewer);
        if (params.openOnComplete !== false) await openViewer(localViewerUrl(config, result.urls.viewer), signal);
        return resultForArtifact(params.action, result, params.copyUrl === true, validation, params.openOnComplete !== false);
      }

      const registry = await getRegistryEntry(canonicalPath);
      const artifactId = params.artifactId ? resolveArtifactIdentifier(params.artifactId) : registry?.artifactId;
      if (!artifactId) throw new Error("No artifact mapping exists for this path. Provide an artifact ID, slug, or canonical URL, or publish it first.");
      const current = await apiRequest<ArtifactRecord>(config, `/v1/artifacts/${encodeURIComponent(artifactId)}`, { signal });
      const result = await apiRequest<ArtifactRecord>(config, `/v1/artifacts/${encodeURIComponent(artifactId)}/versions`, {
        method: "POST",
        headers: { "if-match": `"${current.currentVersion.id}"` },
        body: JSON.stringify({ content, sourceName: basename(canonicalPath), provenance, runtimeMode }),
        signal,
      });
      await remember(canonicalPath, result);
      if (params.copyUrl) await copyUrlToClipboard(result.urls.viewer);
      if (params.openOnComplete !== false) await openViewer(localViewerUrl(config, result.urls.viewer), signal);
      return resultForArtifact(params.action, result, params.copyUrl === true, validation, params.openOnComplete !== false);
    },
  });
}

export function localViewerUrl(config: ArtifactConfig, canonicalUrl: string): string {
  const canonical = new URL(canonicalUrl);
  const api = new URL(config.apiUrl);
  return new URL(`${canonical.pathname}${canonical.search}${canonical.hash}`, api).toString();
}

async function openViewer(url: string, signal?: AbortSignal): Promise<void> {
  if (process.platform === "darwin") await executeFile("open", [url], { signal });
  else await executeFile("xdg-open", [url], { signal });
}

async function resolveOpenUrl(config: ArtifactConfig, params: ArtifactParams, cwd: string, signal?: AbortSignal): Promise<string> {
  if (params.path) {
    const entry = await getRegistryEntry(await realpath(resolveLocalPath(cwd, params.path)));
    if (entry) return entry.viewerUrl;
  }
  if (params.artifactId) {
    const identifier = resolveArtifactIdentifier(params.artifactId);
    const result = await apiRequest<ArtifactRecord>(config, `/v1/artifacts/${encodeURIComponent(identifier)}`, { signal });
    return result.urls.viewer;
  }
  return config.viewerBaseUrl;
}

function requireIdentifier(params: ArtifactParams, action: string): string {
  if (!params.artifactId) throw new Error(`artifactId is required for ${action}.`);
  return resolveArtifactIdentifier(params.artifactId);
}

async function remember(path: string, result: ArtifactRecord): Promise<void> {
  await setRegistryEntry(path, {
    artifactId: result.artifact.id,
    viewerUrl: result.urls.viewer,
    currentVersionId: result.currentVersion.id,
    updatedAt: new Date().toISOString(),
  });
}

async function validateLocalArtifact(params: ArtifactParams, cwd: string) {
  if (!params.path) throw new Error("path is required for validate.");
  const resolvedPath = resolveLocalPath(cwd, params.path);
  const fileStats = await stat(resolvedPath);
  if (!fileStats.isFile()) throw new Error(`Not a regular file: ${params.path}`);
  if (!/\.html?$/i.test(resolvedPath)) throw new Error("Only .html and .htm files are supported.");
  const canonicalPath = await realpath(resolvedPath);
  const runtimeMode: "static" | "interactive" = params.runtimeMode === "interactive" ? "interactive" : "static";
  const report = validateArtifactHtml(await readFile(canonicalPath, "utf8"), runtimeMode);
  return {
    content: [text(formatValidationReport(report))],
    details: { action: "validate", status: report.valid ? "done" : "failed", path: canonicalPath, validation: report },
    isError: !report.valid,
  };
}

function resultForArtifact(action: string, result: ArtifactRecord, copied = false, validation?: ValidationReport, opened = false) {
  const unchanged = result.unchanged ? " (content unchanged)" : "";
  const clipboard = copied ? " (URL copied)" : "";
  const browser = opened ? " (opened)" : "";
  const warnings = validation?.warnings.length ? `\n${validation.warnings.length} validation warning${validation.warnings.length === 1 ? "" : "s"}:\n${validation.warnings.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n")}` : "";
  return {
    content: [text(`${action === "publish" ? "Published" : action === "update" ? "Updated" : action === "archive" ? "Archived" : action === "unarchive" ? "Unarchived" : "Artifact"}: ${result.artifact.title}${unchanged}${clipboard}${browser}\n${result.urls.viewer}\nImmutable: ${result.urls.immutable}${warnings}`)],
    details: { action, status: "done", opened, ...result, ...(validation ? { validation } : {}) },
  };
}

function resultForList(artifacts: ArtifactRecord[]) {
  const lines = artifacts.length
    ? artifacts.map((entry) => `- ${entry.artifact.title} · v${entry.currentVersion.sequence} · ${entry.urls.viewer}`)
    : ["No artifacts found."];
  return { content: [text(lines.join("\n"))], details: { action: "list", status: "done", artifacts } };
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined;
}

function text(value: string): TextContent { return { type: "text", text: value }; }
