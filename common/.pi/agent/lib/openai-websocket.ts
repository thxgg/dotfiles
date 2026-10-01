import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { zstdDecompressSync } from "node:zlib";
import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import type { WebSocket } from "undici";

type Socket = InstanceType<typeof WebSocket>;
type Fetch = NonNullable<StreamOptions["fetch"]>;
type RecordValue = Record<string, unknown>;
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TransportError };

class TransportError extends Error {
  readonly _tag = "OpenAIWebSocketError";
  readonly kind: "handshake" | "aborted" | "stream" | "protocol" | "timeout" | "shutdown";
  constructor(kind: TransportError["kind"]) {
    // Never include a request, headers, credentials, or arbitrary socket error text.
    super(`OpenAI WebSocket ${kind} failure${kind === "stream" ? "; request was not replayed" : ""}`);
    this.kind = kind;
  }
}

const ENDPOINT = "https://api.openai.com/v1/responses";
const SOCKET_ENDPOINT = "wss://api.openai.com/v1/responses";
const MAX_CONNECTION_AGE_MS = 45 * 60_000;
const IDLE_CONNECTION_MS = 120_000;
const MAX_SESSIONS = 16;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_MS = 10 * 60_000;
const TERMINAL = new Set(["response.completed", "response.failed", "response.incomplete", "error"]);

function record(value: unknown): RecordValue | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  // SAFETY: The guard excludes null, arrays and primitives; individual values remain unknown.
  return value as RecordValue;
}

function parsePayload(body: unknown, headers: Headers): Result<RecordValue> {
  try {
    const decoded = headers.get("content-encoding") === "zstd" && body instanceof Uint8Array
      ? zstdDecompressSync(body).toString("utf8") : body;
    const payload = typeof decoded === "string" ? record(JSON.parse(decoded)) : undefined;
    if (!payload || typeof payload.model !== "string" || !/^[a-zA-Z0-9._:-]+$/.test(payload.model)) {
      return { ok: false, error: new TransportError("protocol") };
    }
    return { ok: true, value: payload };
  } catch {
    return { ok: false, error: new TransportError("protocol") };
  }
}

function routingHint(payload: RecordValue): string {
  const tier = typeof payload.service_tier === "string" && /^[a-zA-Z0-9_-]+$/.test(payload.service_tier)
    ? payload.service_tier : undefined;
  return `model=${payload.model}${tier ? `;tier=${tier}` : ""}`;
}

function connect(url: string, headers: Headers): Result<Socket> {
  try {
    // Pi owns this dependency. Resolve it from Pi, not an undeclared top-level install.
    // This also uses Pi's Undici dispatcher, including its configured proxy/TLS policy.
    const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
    // SAFETY: Pi 0.99.x declares Undici with the typed WebSocket constructor used here.
    const undici = require("undici") as typeof import("undici");
    return { ok: true, value: new undici.WebSocket(url, { headers: Object.fromEntries(headers) }) };
  } catch {
    return { ok: false, error: new TransportError("handshake") };
  }
}

interface Connection {
  readonly socket: Socket;
  readonly identity: string;
  readonly createdAt: number;
  readonly session: string | undefined;
  phase: "connecting" | "busy" | "idle" | "closed";
  stop: (error: TransportError) => void;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

/** Persistent public-Responses transport; no global fetch replacement or conversation rewriting. */
export interface OpenAIWebSocketTransport {
  /** Wrap only public OpenAI chat requests. Caller-owned fetch implementations remain HTTP. */
  options<T extends StreamOptions>(model: Model<Api>, options: T): T;
  /** Cancel active requests and release all sockets on reload, session replacement or shutdown. */
  close(): void;
}

/** Network seam for a socket adapter. Constructors must not log request headers. */
export interface WebSocketNetwork {
  /** Open a socket. The production adapter uses Pi's own Undici dependency. */
  connect(url: string, headers: Headers): Result<Socket>;
  /** Optional HTTP adapter for local integration tests; production uses Pi's fetch. */
  fetch?: Fetch;
}

/**
 * Adapt WebSocket Responses events to Pi's existing SSE parser and usage/tool handling.
 * Only handshake failures may fall back to HTTP; a sent request is never replayed here.
 */
export function createOpenAIWebSocketTransport(network: WebSocketNetwork = { connect }): OpenAIWebSocketTransport {
  const sessions = new Map<string, Connection>();
  const active = new Set<Connection>();

  function retire(entry: Connection) {
    if (entry.phase === "closed") return;
    entry.phase = "closed";
    clearTimeout(entry.idleTimer);
    if (entry.session && sessions.get(entry.session) === entry) sessions.delete(entry.session);
    active.delete(entry);
    // A close while CONNECTING cancels the opening handshake in Undici.
    try { entry.socket.close(); } catch { /* already closed */ }
  }

  function release(entry: Connection) {
    if (entry.phase === "closed") return;
    if (!entry.session || sessions.get(entry.session) !== entry || Date.now() - entry.createdAt >= MAX_CONNECTION_AGE_MS || entry.socket.readyState !== 1) {
      retire(entry);
      return;
    }
    entry.phase = "idle";
    entry.stop = () => retire(entry);
    entry.idleTimer = setTimeout(() => retire(entry), IDLE_CONNECTION_MS);
    entry.idleTimer.unref();
  }

  async function acquire(headers: Headers, options: StreamOptions, signal: AbortSignal): Promise<Result<Connection>> {
    // Hash every handshake header, including the bearer token. A token refresh, account,
    // model, tier, or header change cannot reuse a socket authenticated/routed differently.
    const identity = createHash("sha256").update(JSON.stringify([...headers].sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
    const previous = options.sessionId ? sessions.get(options.sessionId) : undefined;
    if (previous?.phase === "idle") {
      if (previous.identity === identity && previous.socket.readyState === 1 && Date.now() - previous.createdAt < MAX_CONNECTION_AGE_MS) {
        clearTimeout(previous.idleTimer);
        previous.phase = "busy";
        return { ok: true, value: previous };
      }
      retire(previous);
    }
    if (signal.aborted) return { ok: false, error: new TransportError("aborted") };
    const opened = network.connect(SOCKET_ENDPOINT, headers);
    if (!opened.ok) return opened;
    // Overlapping requests never share a socket. Keep the existing session owner and
    // make the overlapping request ephemeral, including concurrent compaction calls.
    const session = previous && previous.phase !== "closed" ? undefined : options.sessionId;
    const entry: Connection = {
      socket: opened.value, identity, createdAt: Date.now(), session,
      phase: "connecting", stop: () => {}, idleTimer: undefined,
    };
    active.add(entry);
    entry.socket.addEventListener("error", () => entry.stop(new TransportError(entry.phase === "connecting" ? "handshake" : "stream")));
    entry.socket.addEventListener("close", () => entry.stop(new TransportError(entry.phase === "connecting" ? "handshake" : "stream")));
    return new Promise((resolve) => {
      let settled = false;
      const connectMs = options.websocketConnectTimeoutMs ?? 15_000;
      const timeout = connectMs > 0 ? setTimeout(() => fail(new TransportError("handshake")), connectMs) : undefined;
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        entry.socket.removeEventListener("open", ready);
      };
      const fail = (error: TransportError) => {
        if (settled) return;
        settled = true;
        cleanup(); retire(entry);
        resolve({ ok: false, error });
      };
      const abort = () => fail(new TransportError("aborted"));
      const ready = () => {
        if (settled) return;
        settled = true;
        cleanup();
        entry.phase = "busy";
        entry.stop = () => retire(entry);
        if (session) {
          if (sessions.size >= MAX_SESSIONS) {
            const idle = [...sessions.values()].find(value => value.phase === "idle");
            if (idle) retire(idle);
          }
          if (sessions.size < MAX_SESSIONS) sessions.set(session, entry);
        }
        resolve({ ok: true, value: entry });
      };
      entry.stop = fail;
      entry.socket.addEventListener("open", ready);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  function stream(entry: Connection, payload: RecordValue, signal: AbortSignal, options: StreamOptions): Response {
    const encoder = new TextEncoder();
    const event: RecordValue = { ...payload, type: "response.create" };
    // WebSocket implicitly streams. All context, tools, images and reasoning items
    // remain Pi-owned. No prefill or previous_response_id optimization is introduced.
    delete event.stream;
    delete event.background;
    const idleMs = options.timeoutMs ?? 300_000;
    let cancel = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let settled = false;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const totalTimer = setTimeout(() => fail(new TransportError("timeout")), MAX_REQUEST_MS);
        const cleanup = () => {
          clearTimeout(idleTimer); clearTimeout(totalTimer);
          signal.removeEventListener("abort", abort);
          entry.socket.removeEventListener("message", message);
        };
        const fail = (error: TransportError) => {
          if (settled) return;
          settled = true;
          cleanup(); retire(entry);
          controller.error(error);
        };
        const abort = () => fail(new TransportError("aborted"));
        const resetIdle = () => {
          clearTimeout(idleTimer);
          if (idleMs > 0) idleTimer = setTimeout(() => fail(new TransportError("timeout")), idleMs);
        };
        const message = (received: { data: unknown }) => {
          if (settled) return;
          const raw = received.data;
          if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_BUFFER_BYTES) {
            fail(new TransportError("protocol")); return;
          }
          let parsed: RecordValue | undefined;
          try { parsed = record(JSON.parse(raw)); } catch { /* handled below */ }
          if (!parsed || typeof parsed.type !== "string") { fail(new TransportError("protocol")); return; }
          // OpenAI's top-level WS errors nest the error while its SSE parser expects
          // top-level code/message. Convert only the envelope, not the server error.
          const error = parsed.type === "error" ? record(parsed.error) : undefined;
          const normalized = error ? { ...error, type: "error" } : parsed;
          const bytes = encoder.encode(`data: ${JSON.stringify(normalized)}\n\n`);
          if ((controller.desiredSize ?? 0) < bytes.byteLength) { fail(new TransportError("protocol")); return; }
          controller.enqueue(bytes);
          resetIdle();
          if (TERMINAL.has(parsed.type)) {
            settled = true;
            cleanup(); controller.close();
            if (parsed.type === "response.completed") release(entry);
            else retire(entry);
          }
        };
        cancel = () => {
          if (settled) return;
          settled = true; cleanup(); retire(entry);
        };
        entry.stop = fail;
        entry.socket.addEventListener("message", message);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) { abort(); return; }
        resetIdle();
        // No fallback after this boundary, even if send throws or no text arrives.
        try { entry.socket.send(JSON.stringify(event)); } catch { fail(new TransportError("stream")); }
      },
      cancel() { cancel(); },
    }, { highWaterMark: MAX_BUFFER_BYTES, size: chunk => chunk?.byteLength ?? 0 });
    return new Response(body, { headers: { "content-type": "text/event-stream", "x-pi-transport": "websocket" } });
  }

  return {
    options(model, options) {
      if (model.provider !== "openai" || model.api !== "openai-responses" || model.baseUrl.replace(/\/$/, "") !== "https://api.openai.com/v1") return options;
      const http = options.fetch ?? network.fetch ?? globalThis.fetch;
      // Pi's global dispatcher owns ordinary proxy settings. A caller-specific proxy
      // environment belongs to its HTTP adapter, not this shared socket dispatcher.
      const scopedProxy = Object.keys(options.env ?? {}).some(key => /^(https?_proxy|all_proxy|no_proxy)$/i.test(key));
      const useWebSocket = options.transport !== "sse" && !options.fetch && !scopedProxy;
      // Preserve runtime fetch properties (for example Bun's preconnect) at this seam.
      const fetch = Object.assign(async (url: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
        const address = typeof url === "string" || url instanceof URL ? String(url) : url.url;
        if (address !== ENDPOINT || !init) return http(url, init);
        const headers = new Headers(init.headers);
        const parsed = parsePayload(init.body, headers);
        // Unknown/non-streaming/custom protocol bodies stay on Pi's native path.
        if (!parsed.ok || parsed.value.stream !== true) return http(url, init);
        const payload = parsed.value;
        headers.set("x-codex-routing-hint", routingHint(payload));
        const fallback = () => http(url, { ...init, headers });
        if (!useWebSocket || payload.background || payload.previous_response_id || payload.conversation) return fallback();
        const signal = init.signal ?? options.signal ?? new AbortController().signal;
        if (signal.aborted) throw new TransportError("aborted"); // Fetch boundary requires rejection.
        const handshake = new Headers(headers);
        for (const name of ["content-type", "content-length", "content-encoding", "accept-encoding"]) handshake.delete(name);
        const connection = await acquire(handshake, options, signal);
        if (!connection.ok) {
          if (connection.error.kind === "handshake" && (!options.transport || options.transport === "auto") && !signal.aborted) return fallback();
          throw connection.error; // Translate the typed transport failure at the Fetch boundary.
        }
        return stream(connection.value, payload, signal, options);
      }, http);
      return { ...options, fetch };
    },
    close() {
      for (const entry of [...active]) {
        entry.stop(new TransportError("shutdown"));
        retire(entry);
      }
    },
  };
}
