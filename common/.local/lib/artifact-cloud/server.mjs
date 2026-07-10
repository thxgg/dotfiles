#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { URL } from "node:url";
import { ArtifactStore, MAX_ARTIFACT_BYTES, tokenMatches } from "./core.mjs";

const host = process.env.ARTIFACT_CLOUD_HOST || "127.0.0.1";
const port = parsePort(process.env.ARTIFACT_CLOUD_PORT || "3000");
const dataDir = requireEnvironment("ARTIFACT_CLOUD_DATA_DIR");
const publishToken = requireEnvironment("ARTIFACT_CLOUD_PUBLISH_TOKEN");
const configuredBaseUrl = trimTrailingSlash(process.env.ARTIFACT_CLOUD_BASE_URL || `http://${host}:${port}`);
const store = await new ArtifactStore(dataDir).open();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const status = error.statusCode || (error.code === "VALIDATION_FAILED" ? 422 : ["VERSION_CONFLICT", "ARTIFACT_NOT_ARCHIVED", "SLUG_CONFLICT"].includes(error.code) ? 409 : 500);
    if (status >= 500) console.error(error);
    sendJson(response, status, { error: status >= 500 ? "Internal server error." : error.message });
  }
});

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(port, host, () => console.log(`artifact-cloud listening on http://${host}:${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => {
    store.close();
    process.exit(0);
  }));
}

async function route(request, response) {
  const url = new URL(request.url, configuredBaseUrl);
  applyCommonHeaders(response);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, { ok: true, service: "artifact-cloud" });
  }

  if (request.method === "GET" && url.pathname === "/") {
    const filters = {
      search: url.searchParams.get("q") || undefined,
      tag: url.searchParams.get("tag") || undefined,
      sort: url.searchParams.get("sort") || "updated",
      includeArchived: url.searchParams.get("archived") === "1",
    };
    const artifacts = store.listArtifacts(filters);
    return sendHtml(response, 200, renderGallery(artifacts, filters), applicationCsp());
  }

  if (request.method === "GET" && url.pathname === "/v1/artifacts") {
    const artifacts = store.listArtifacts({
      search: url.searchParams.get("q") || undefined,
      tag: url.searchParams.get("tag") || undefined,
      sort: url.searchParams.get("sort") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      includeArchived: url.searchParams.get("archived") === "1",
    });
    return sendJson(response, 200, { artifacts: artifacts.map(withUrls) });
  }

  if (request.method === "POST" && url.pathname === "/v1/artifacts") {
    requirePublisher(request);
    const body = await readJson(request);
    const artifact = await store.createArtifact(body);
    return sendJson(response, 201, withUrls(artifact), { etag: quoteEtag(artifact.currentVersion.id) });
  }

  const artifactApiMatch = url.pathname.match(/^\/v1\/artifacts\/([a-z0-9-]+)$/i);
  if (artifactApiMatch && request.method === "GET") {
    const artifact = store.getArtifact(artifactApiMatch[1]);
    if (!artifact) return sendJson(response, 404, { error: "Artifact not found." });
    return sendJson(response, 200, withUrls(artifact), { etag: quoteEtag(artifact.currentVersion.id) });
  }
  if (artifactApiMatch && request.method === "PATCH") {
    requirePublisher(request);
    const artifact = await store.updateArtifact(artifactApiMatch[1], await readJson(request));
    if (!artifact) return sendJson(response, 404, { error: "Artifact not found." });
    return sendJson(response, 200, withUrls(artifact), { etag: quoteEtag(artifact.currentVersion.id) });
  }
  if (artifactApiMatch && request.method === "DELETE") {
    requirePublisher(request);
    const artifact = store.getArtifact(artifactApiMatch[1]);
    if (!artifact) return sendJson(response, 404, { error: "Artifact not found." });
    if (firstHeader(request.headers["x-confirm-artifact-id"]) !== artifact.id) {
      return sendJson(response, 400, { error: "Permanent deletion requires X-Confirm-Artifact-Id with the exact artifact ID." });
    }
    await store.deleteArtifact(artifact.id);
    response.writeHead(204);
    return response.end();
  }

  const versionListMatch = url.pathname.match(/^\/v1\/artifacts\/([a-z0-9-]+)\/versions$/i);
  if (versionListMatch && request.method === "GET") {
    const artifact = store.getArtifact(versionListMatch[1]);
    if (!artifact) return sendJson(response, 404, { error: "Artifact not found." });
    return sendJson(response, 200, { versions: store.listVersions(artifact.id).map((version) => withVersionUrls(version, artifact)) });
  }
  if (versionListMatch && request.method === "POST") {
    requirePublisher(request);
    const expectedCurrentVersionId = unquoteEtag(request.headers["if-match"]);
    if (!expectedCurrentVersionId) return sendJson(response, 428, { error: "If-Match with the expected current version ID is required." });
    const existing = store.getArtifact(versionListMatch[1]);
    if (!existing) return sendJson(response, 404, { error: "Artifact not found." });
    const artifact = await store.appendVersion(existing.id, await readJson(request), { expectedCurrentVersionId });
    if (!artifact) return sendJson(response, 404, { error: "Artifact not found." });
    return sendJson(response, artifact.unchanged ? 200 : 201, withUrls(artifact), { etag: quoteEtag(artifact.currentVersion.id) });
  }

  const viewerMatch = url.pathname.match(/^\/a\/([a-z0-9-]+|[0-9a-f-]+)$/i);
  if (viewerMatch && request.method === "GET") {
    const artifact = store.getArtifact(viewerMatch[1]);
    if (!artifact) return sendHtml(response, 404, renderNotFound(), applicationCsp());
    return sendHtml(response, 200, renderViewer(artifact, store.listVersions(artifact.id)), applicationCspWithScripts());
  }

  const immutableMatch = url.pathname.match(/^\/v\/([0-9a-f-]+)$/i);
  if (immutableMatch && (request.method === "GET" || request.method === "HEAD")) {
    const version = store.getVersion(immutableMatch[1]);
    if (!version || version.archivedAt) return sendText(response, 404, "Artifact version not found.");
    const content = await store.readVersionContent(version);
    return sendArtifact(response, content, version, request.method === "HEAD");
  }

  return sendHtml(response, 404, renderNotFound(), applicationCsp());
}

function requirePublisher(request) {
  const authorization = firstHeader(request.headers.authorization);
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!tokenMatches(publishToken, bearer)) {
    const error = new Error("Publisher token required.");
    error.statusCode = 401;
    throw error;
  }
}

async function readJson(request) {
  const contentType = firstHeader(request.headers["content-type"]);
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json.");
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_ARTIFACT_BYTES + 64 * 1024) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, status, value, headers = {}) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), ...headers });
  response.end(body);
}

function sendHtml(response, status, body, csp) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Content-Security-Policy": csp });
  response.end(body);
}

function sendText(response, status, body) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function sendArtifact(response, content, version, headOnly = false) {
  const nonce = version.runtimeMode === "interactive" ? randomBytes(18).toString("base64") : undefined;
  const body = nonce ? injectInteractiveRuntime(content, nonce) : content;
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Content-Security-Policy": artifactCsp(version.runtimeMode, nonce),
    "Cache-Control": "public, max-age=31536000, immutable",
    "ETag": `"sha256-${version.sha256}"`,
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  response.end(headOnly ? undefined : body);
}

function applyCommonHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

function applicationCsp() {
  return "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
}

function applicationCspWithScripts() {
  return "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
}

function artifactCsp(runtimeMode = "static", nonce) {
  const scripts = runtimeMode === "interactive" && nonce ? `'nonce-${nonce}'` : "'none'";
  return `default-src 'none'; script-src ${scripts}; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'`;
}

function injectInteractiveRuntime(content, nonce) {
  const html = content.toString("utf8");
  const script = `<script nonce="${nonce}">${INTERACTIVE_RUNTIME}</script>`;
  const closingBody = html.toLowerCase().lastIndexOf("</body>");
  return Buffer.from(closingBody >= 0 ? `${html.slice(0, closingBody)}${script}${html.slice(closingBody)}` : `${html}${script}`);
}

const INTERACTIVE_RUNTIME = `(()=>{const root=document;const byId=(id)=>root.getElementById(id);root.querySelectorAll('[data-artifact-increment]').forEach((button)=>button.addEventListener('click',()=>{const output=byId(button.dataset.artifactIncrement);if(!output)return;const next=Number(output.textContent||output.value||0)+Number(button.dataset.artifactStep||1);output.textContent=String(next);output.value=String(next)}));root.querySelectorAll('[data-artifact-toggle]').forEach((button)=>button.addEventListener('click',()=>{const target=byId(button.dataset.artifactToggle);if(!target)return;target.hidden=!target.hidden;button.setAttribute('aria-expanded',String(!target.hidden))}));root.querySelectorAll('[data-artifact-show]').forEach((button)=>button.addEventListener('click',()=>{const group=button.dataset.artifactGroup||'default';root.querySelectorAll('[data-artifact-panel]').forEach((panel)=>{if((panel.dataset.artifactGroup||'default')===group)panel.hidden=panel.id!==button.dataset.artifactShow});root.querySelectorAll('[data-artifact-show]').forEach((item)=>{if((item.dataset.artifactGroup||'default')===group)item.setAttribute('aria-selected',String(item===button))})}));root.querySelectorAll('[data-artifact-filter]').forEach((button)=>button.addEventListener('click',()=>{const value=button.dataset.artifactFilter;const group=button.dataset.artifactGroup||'default';root.querySelectorAll('[data-artifact-item]').forEach((item)=>{if((item.dataset.artifactGroup||'default')===group)item.hidden=value!=='*'&&!String(item.dataset.artifactItem||'').split(/\\s+/).includes(value)})}))})();`;

function withUrls(artifact) {
  return {
    artifact: {
      id: artifact.id,
      slug: artifact.slug,
      title: artifact.title,
      description: artifact.description,
      tags: artifact.tags,
      currentVersionId: artifact.currentVersionId,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
      archivedAt: artifact.archivedAt,
    },
    currentVersion: publicVersion(artifact.currentVersion),
    urls: {
      viewer: absolute(`/a/${artifact.slug}`),
      immutable: absolute(`/v/${artifact.currentVersion.id}`),
      api: absolute(`/v1/artifacts/${artifact.id}`),
    },
    unchanged: artifact.unchanged === true,
  };
}

function withVersionUrls(version, artifact) {
  return { ...publicVersion(version), urls: { immutable: absolute(`/v/${version.id}`), viewer: absolute(`/a/${artifact.slug}`) } };
}

function publicVersion(version) {
  return {
    id: version.id,
    artifactId: version.artifactId,
    sequence: version.sequence,
    sha256: version.sha256,
    mediaType: version.mediaType,
    byteSize: version.byteSize,
    sourceName: version.sourceName,
    runtimeMode: version.runtimeMode,
    createdAt: version.createdAt,
  };
}

function absolute(path) {
  return `${configuredBaseUrl}${path}`;
}

function renderGallery(artifacts, filters = {}) {
  const cards = artifacts.length ? artifacts.map((artifact) => `
    <article class="artifact${artifact.archivedAt ? " archived" : ""}">
      <a class="artifact-link" href="/a/${encodeURIComponent(artifact.slug)}">
        <div class="artifact-head"><strong>${escapeHtml(artifact.title)}</strong><span>${artifact.archivedAt ? "ARCHIVED" : `${artifact.currentVersion.runtimeMode === "interactive" ? "INTERACTIVE · " : ""}v${artifact.currentVersion.sequence}`}</span></div>
        <p>${escapeHtml(artifact.description || "No description")}</p>
        <div class="meta"><span>${escapeHtml(artifact.currentVersion.sourceName)}</span><span>${formatBytes(artifact.currentVersion.byteSize)}</span><span>${formatDate(artifact.updatedAt)}</span></div>
      </a>
      <div class="tags">${artifact.tags.map((tag) => `<a href="/?tag=${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`).join("")}</div>
    </article>`).join("") : `<div class="empty"><strong>No matching artifacts.</strong><p>Clear the filters or publish a new HTML artifact from Pi.</p></div>`;
  const selectedSort = ["updated", "created", "title", "oldest"].includes(filters.sort) ? filters.sort : "updated";
  const active = [filters.search ? `search: “${escapeHtml(filters.search)}”` : "", filters.tag ? `tag: #${escapeHtml(filters.tag)}` : "", filters.includeArchived ? "including archived" : ""].filter(Boolean);
  return documentShell("Artifacts", `
    <header class="hero"><p class="eyebrow">PERSONAL / TAILNET</p><h1>Artifacts</h1><p>Things Pi made, versioned and available across your personal fleet.</p></header>
    <form class="filters" method="get">
      <input name="q" type="search" value="${escapeHtml(filters.search || "")}" placeholder="Search title, description, or slug" aria-label="Search artifacts">
      <select name="sort" aria-label="Sort artifacts"><option value="updated"${selectedSort === "updated" ? " selected" : ""}>Recently updated</option><option value="created"${selectedSort === "created" ? " selected" : ""}>Recently created</option><option value="title"${selectedSort === "title" ? " selected" : ""}>Title A–Z</option><option value="oldest"${selectedSort === "oldest" ? " selected" : ""}>Least recently updated</option></select>
      <label class="archive-filter"><input name="archived" type="checkbox" value="1"${filters.includeArchived ? " checked" : ""}> Archived</label>
      ${filters.tag ? `<input type="hidden" name="tag" value="${escapeHtml(filters.tag)}">` : ""}<button>Apply</button>
    </form>
    <div class="results"><span>${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}</span>${active.length ? `<span>${active.join(" · ")} · <a href="/">clear</a></span>` : ""}</div>
    <main class="gallery">${cards}</main>`);
}

function renderViewer(artifact, versions) {
  const canonicalUrl = absolute(`/a/${artifact.slug}`);
  const immutableUrl = absolute(`/v/${artifact.currentVersion.id}`);
  const versionRows = versions.map((version) => `<a href="/v/${version.id}"${version.id === artifact.currentVersion.id ? ' aria-current="page"' : ""}><span>v${version.sequence}</span><span>${version.id === artifact.currentVersion.id ? `Current · ${version.runtimeMode}` : `${formatDate(version.createdAt)} · ${version.runtimeMode}`}</span><span>${formatBytes(version.byteSize)}</span></a>`).join("");
  return documentShell(artifact.title, `
    <header class="viewer-head"><div><p class="eyebrow">ARTIFACT / ${escapeHtml(artifact.slug)}${artifact.archivedAt ? " / ARCHIVED" : ""}</p><h1>${escapeHtml(artifact.title)}</h1><p>${escapeHtml(artifact.description)}</p><div class="tags">${artifact.tags.map((tag) => `<a href="/?tag=${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`).join("")}</div></div>${artifact.archivedAt ? '<span class="open">Archived · content unavailable</span>' : `<a class="open" href="/v/${artifact.currentVersion.id}">Open current ↗</a>`}</header>
    <section class="url-panel" aria-label="Artifact URLs"><div><span class="url-kind">CANONICAL · ALWAYS CURRENT</span><code>${escapeHtml(canonicalUrl)}</code><button type="button" data-copy="${escapeHtml(canonicalUrl)}">Copy</button></div><div><span class="url-kind">IMMUTABLE · VERSION ${artifact.currentVersion.sequence}</span><code>${escapeHtml(immutableUrl)}</code><button type="button" data-copy="${escapeHtml(immutableUrl)}">Copy</button></div></section>
    <main class="viewer-grid"><section class="frame">${artifact.archivedAt ? '<div class="archived-message"><strong>Artifact archived</strong><p>Metadata and version history are retained, but rendered content is unavailable until this artifact is unarchived.</p></div>' : `<iframe src="/v/${artifact.currentVersion.id}" sandbox="${artifact.currentVersion.runtimeMode === "interactive" ? "allow-scripts" : ""}" title="${escapeHtml(artifact.title)}"></iframe>`}</section><aside><h2>Version history</h2><div class="versions">${versionRows}</div><h2>Details</h2><dl><dt>Artifact ID</dt><dd><code>${artifact.id}</code></dd><dt>Current SHA-256</dt><dd><code>${artifact.currentVersion.sha256}</code></dd><dt>Created</dt><dd>${formatDate(artifact.createdAt)}</dd><dt>Updated</dt><dd>${formatDate(artifact.updatedAt)}</dd>${artifact.archivedAt ? `<dt>Archived</dt><dd>${formatDate(artifact.archivedAt)}</dd>` : ""}</dl></aside></main>`, copyScript());
}

function renderNotFound() {
  return documentShell("Not found", `<main class="not-found"><p class="eyebrow">404</p><h1>Artifact not found.</h1><a href="/">Return to index</a></main>`);
}

function documentShell(title, content, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLES}</style></head><body><div class="shell"><nav><a href="/">ARTIFACT CLOUD</a><span>cosmiccruiser · temporary host</span></nav>${content}<footer>Authored scripts blocked · Tailnet access · Temporary laptop URLs</footer></div>${script}</body></html>`;
}

function copyScript() {
  return `<script>document.querySelectorAll("[data-copy]").forEach((button)=>button.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent="Copied";setTimeout(()=>button.textContent="Copy",1200)}catch{button.textContent="Select URL"}}));</script>`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function quoteEtag(value) { return `"${value}"`; }
function unquoteEtag(value) {
  const header = firstHeader(value);
  if (!header) return undefined;
  const match = /^"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"$/i.exec(header.trim());
  return match?.[1];
}
function firstHeader(value) { return Array.isArray(value) ? value[0] : value; }
function trimTrailingSlash(value) { return value.replace(/\/+$/, ""); }
function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function parsePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ARTIFACT_CLOUD_PORT must be a valid port.");
  return port;
}

const STYLES = `
:root{color-scheme:dark;--bg:#090c0f;--panel:#11161b;--panel2:#171d23;--line:#29323a;--ink:#edf2f5;--soft:#aeb9c1;--muted:#73808a;--blue:#78b8ff;--mint:#86ddb2;--lav:#b7adff;--mono:"SFMono-Regular",Consolas,monospace;--sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% -10%,rgba(120,184,255,.12),transparent 30rem),var(--bg);color:var(--ink);font:15px/1.55 var(--sans)}a{color:inherit}.shell{width:min(1120px,calc(100% - 36px));margin:auto}nav{min-height:62px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);font:11px/1 var(--mono);color:var(--muted)}nav a{color:var(--ink);text-decoration:none}.hero{padding:82px 0 48px;border-bottom:1px solid var(--line)}.eyebrow{color:var(--blue);font:700 11px/1 var(--mono);letter-spacing:.12em}.hero h1,.viewer-head h1,.not-found h1{margin:17px 0 12px;font-size:clamp(46px,8vw,86px);line-height:.96;letter-spacing:-.065em}.hero>p:last-child,.viewer-head p{max-width:680px;color:var(--soft);font-size:18px}.filters{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;padding:24px 0 12px}.filters input[type=search]{min-width:0}.filters input,.filters select,.filters button,.archive-filter{border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:11px 13px}.filters button{cursor:pointer;color:var(--blue);font-family:var(--mono)}.archive-filter{display:flex;align-items:center;gap:7px;color:var(--soft);font:11px var(--mono)}.results{display:flex;justify-content:space-between;gap:20px;padding:0 0 20px;color:var(--muted);font:10px var(--mono)}.results a{color:var(--blue)}.gallery{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line)}.artifact{min-width:0;padding:25px}.artifact:nth-child(2n){border-left:1px solid var(--line)}.artifact:nth-child(n+3){border-top:1px solid var(--line)}.artifact:hover{background:var(--panel)}.artifact.archived{opacity:.58}.artifact-link{display:block;text-decoration:none}.artifact-head{display:flex;justify-content:space-between;gap:20px}.artifact-head strong{font-size:20px}.artifact-head span{color:var(--blue);font:11px var(--mono)}.artifact p{color:var(--soft);min-height:46px}.meta,.tags{display:flex;flex-wrap:wrap;gap:10px;color:var(--muted);font:10px var(--mono)}.tags{margin-top:18px}.tags a{color:var(--mint);text-decoration:none}.tags a:hover{text-decoration:underline}.empty{grid-column:1/-1;padding:60px;text-align:center}.empty p{color:var(--muted)}.viewer-head{padding:65px 0 35px;display:flex;justify-content:space-between;gap:30px;align-items:end}.viewer-head h1{font-size:clamp(42px,6vw,72px)}.open{color:var(--blue);font:12px var(--mono);white-space:nowrap}.url-panel{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);margin-bottom:14px}.url-panel>div{min-width:0;padding:16px;display:grid;grid-template-columns:1fr auto;gap:8px}.url-panel>div+div{border-left:1px solid var(--line)}.url-kind{grid-column:1/-1;color:var(--lav);font:700 9px var(--mono);letter-spacing:.08em}.url-panel code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--soft);font-size:10px}.url-panel button{border:0;background:none;color:var(--blue);cursor:pointer;font:10px var(--mono)}.viewer-grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;border:1px solid var(--line);min-height:70vh}.frame{padding:12px;background:var(--panel)}iframe{display:block;width:100%;height:100%;min-height:680px;border:0;background:white}.archived-message{min-height:680px;display:grid;align-content:center;justify-items:center;text-align:center;padding:40px;color:var(--soft)}.archived-message strong{color:var(--ink);font-size:24px}.archived-message p{max-width:480px}aside{padding:24px;border-left:1px solid var(--line)}aside h2{margin:0 0 15px;color:var(--muted);font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase}.versions{margin-bottom:35px;border-top:1px solid var(--line)}.versions a{display:grid;grid-template-columns:35px 1fr auto;gap:8px;padding:11px 0;border-bottom:1px solid var(--line);text-decoration:none;color:var(--soft);font:10px var(--mono)}.versions a[aria-current=page]{color:var(--mint)}.versions a:hover{color:var(--blue)}dl{display:grid;gap:8px;margin:0}dt{color:var(--muted);font:10px var(--mono)}dd{margin:0;overflow-wrap:anywhere;color:var(--soft);font-size:12px}.not-found{min-height:75vh;display:grid;align-content:center}.not-found a{color:var(--blue)}footer{padding:35px 0 50px;color:var(--muted);font:10px var(--mono)}@media(max-width:720px){.filters{grid-template-columns:1fr 1fr}.filters input[type=search]{grid-column:1/-1}.results{display:block}.results span{display:block;margin-top:5px}.gallery,.viewer-grid,.url-panel{grid-template-columns:1fr}.artifact:nth-child(2n){border-left:0}.artifact:nth-child(n+2){border-top:1px solid var(--line)}.viewer-head{display:block}.open{display:inline-block;margin-top:15px}.url-panel>div+div{border-left:0;border-top:1px solid var(--line)}aside{border-left:0;border-top:1px solid var(--line)}iframe{min-height:70vh}}
`;
