import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { Agent, type Dispatcher } from "undici";
import {
	FetchPublicWebClient,
	classifyMimeType,
	fetchWithRedirects,
	isPrivateOrLocalIp,
	parseContentType,
	type DispatcherFactory,
	type DnsRecord,
} from "../network.ts";
import { parsePublicHttpUrl } from "../types.ts";
import type { PublicWebRequest } from "../public-web-client.ts";

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

test("parseContentType normalizes html and xhtml content types", () => {
	assert.equal(parseContentType("TEXT/HTML; charset=UTF-8").kind, "html");
	assert.equal(parseContentType("TEXT/HTML; charset=UTF-8").mime, "text/html");
	assert.equal(parseContentType("application/xhtml+xml; charset=utf-8").kind, "html");
	assert.equal(parseContentType("image/svg+xml").kind, "svg");
});

test("classifyMimeType recognizes supported raster images and binary fallback", () => {
	assert.equal(classifyMimeType("image/png"), "raster-image");
	assert.equal(classifyMimeType("application/octet-stream"), "binary");
	assert.equal(classifyMimeType("application/json"), "text");
});

test("isPrivateOrLocalIp detects local and private IP ranges", () => {
	assert.equal(isPrivateOrLocalIp("127.0.0.1"), true);
	assert.equal(isPrivateOrLocalIp("10.0.0.5"), true);
	assert.equal(isPrivateOrLocalIp("192.168.1.20"), true);
	assert.equal(isPrivateOrLocalIp("172.20.0.1"), true);
	assert.equal(isPrivateOrLocalIp("::1"), true);
	assert.equal(isPrivateOrLocalIp("fc00::1"), true);
	assert.equal(isPrivateOrLocalIp("::ffff:127.0.0.1"), true);
	assert.equal(isPrivateOrLocalIp("::ffff:7f00:1"), true);
	assert.equal(isPrivateOrLocalIp("0:0:0:0:0:ffff:7f00:1"), true);
	assert.equal(isPrivateOrLocalIp("::ffff:a00:1"), true);
	assert.equal(isPrivateOrLocalIp("::ffff:c0a8:114"), true);
	assert.equal(isPrivateOrLocalIp("::127.0.0.1"), true);
	assert.equal(isPrivateOrLocalIp("::7f00:1"), true);
	assert.equal(isPrivateOrLocalIp("198.18.0.1"), true);
	assert.equal(isPrivateOrLocalIp("192.0.0.1"), true);
	assert.equal(isPrivateOrLocalIp("224.0.0.1"), true);
	assert.equal(isPrivateOrLocalIp("240.0.0.1"), true);
	assert.equal(isPrivateOrLocalIp("255.255.255.255"), true);
	assert.equal(isPrivateOrLocalIp("fec0::1"), true);
	assert.equal(isPrivateOrLocalIp("ff00::1"), true);
	assert.equal(isPrivateOrLocalIp("2001:db8::1"), true);
	assert.equal(isPrivateOrLocalIp("8.8.8.8"), false);
	assert.equal(isPrivateOrLocalIp("2001:4860:4860::8888"), false);
	assert.equal(isPrivateOrLocalIp("::ffff:808:808"), false);
});

test("fetchWithRedirects resolves a hostname once and connects through that pinned address", async () => {
	const server = await startServer((_request, response) => response.end("pinned"));
	let resolutions = 0;
	try {
		const port = new URL(server.origin).port;
		const result = await fetchWithRedirects(new URL(`http://pinned.example:${port}/`), {
			headers: {},
			maxRedirects: 0,
			blockPrivateHosts: false,
			resolver: async (hostname) => {
				resolutions += 1;
				assert.equal(hostname, "pinned.example");
				return [{ address: "127.0.0.1", family: 4 }];
			},
		});
		try {
			assert.equal(await result.response.text(), "pinned");
			assert.equal(resolutions, 1);
		} finally {
			await result.dispose();
		}
	} finally {
		await server.close();
	}
});

test("fetchWithRedirects pins the complete validated DNS answer set", async () => {
	const server = await startServer((_request, response) => response.end("ok"));
	const port = new URL(server.origin).port;
	try {
		const result = await fetchWithRedirects(new URL(`http://multi.example:${port}/`), {
			headers: {},
			maxRedirects: 0,
			blockPrivateHosts: false,
			resolver: async () => [
				{ address: "192.0.2.1", family: 4 },
				{ address: "127.0.0.1", family: 4 },
			],
			dispatcherFactory: (records) => {
				assert.deepEqual(records, [
					{ address: "192.0.2.1", family: 4 },
					{ address: "127.0.0.1", family: 4 },
				]);
				return createPinnedAgent([records[1]!]);
			},
		});
		try {
			assert.equal(await result.response.text(), "ok");
		} finally {
			await result.dispose();
		}
	} finally {
		await server.close();
	}
});

test("fetchWithRedirects blocks mixed public and private DNS answers", async () => {
	let transports = 0;
	await assert.rejects(
		fetchWithRedirects(new URL("http://mixed.example/"), {
			headers: {},
			maxRedirects: 0,
			blockPrivateHosts: true,
			resolver: async () => [
				{ address: "93.184.216.34", family: 4 },
				{ address: "127.0.0.1", family: 4 },
			],
			dispatcherFactory: () => {
				transports += 1;
				return new Agent();
			},
		}),
		/Blocked private or local IP address/,
	);
	assert.equal(transports, 0);
});

test("fetchWithRedirects fails closed when DNS resolution fails", async () => {
	let transports = 0;
	const dnsError = new Error("dns unavailable");
	await assert.rejects(
		fetchWithRedirects(new URL("http://unresolved.example/"), {
			headers: {},
			maxRedirects: 0,
			blockPrivateHosts: true,
			resolver: async () => Promise.reject(dnsError),
			dispatcherFactory: () => {
				transports += 1;
				return new Agent();
			},
		}),
		(error) => error === dnsError,
	);
	assert.equal(transports, 0);
});

test("fetchWithRedirects validates every redirect before opening its transport", async () => {
	const server = await startServer((_request, response) => {
		response.writeHead(302, { location: "http://mixed.example/target" });
		response.end();
	});
	const port = new URL(server.origin).port;
	const resolved: string[] = [];
	let transports = 0;
	try {
		await assert.rejects(
			fetchWithRedirects(new URL(`http://public.example:${port}/`), {
				headers: {},
				maxRedirects: 2,
				blockPrivateHosts: true,
				resolver: async (hostname) => {
					resolved.push(hostname);
					return hostname === "public.example"
						? [{ address: "93.184.216.34", family: 4 }]
						: [
								{ address: "93.184.216.34", family: 4 },
								{ address: "127.0.0.1", family: 4 },
							];
				},
				dispatcherFactory: () => {
					transports += 1;
					return createPinnedAgent([{ address: "127.0.0.1", family: 4 }]);
				},
			}),
			/Blocked private or local IP address/,
		);
		assert.deepEqual(resolved, ["public.example", "mixed.example"]);
		assert.equal(transports, 1);
	} finally {
		await server.close();
	}
});

test("fetchWithRedirects exposes an idempotent lease that disposes the final transport", async () => {
	const server = await startServer((_request, response) => response.end("ok"));
	let closes = 0;
	try {
		const result = await fetchWithRedirects(new URL(server.origin), {
			headers: {},
			maxRedirects: 0,
			blockPrivateHosts: false,
			dispatcherFactory: createTrackedDispatcherFactory(() => {
				closes += 1;
			}),
		});
		await result.response.text();
		await result.dispose();
		await result.dispose();
		assert.equal(closes, 1);
	} finally {
		await server.close();
	}
});

test("FetchPublicWebClient follows redirects when private host blocking is disabled", async () => {
	const server = await startServer((request, response) => {
		if (request.url === "/redirect") {
			response.writeHead(302, { location: "/final" });
			response.end();
			return;
		}
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("ok");
	});
	try {
		const client = new FetchPublicWebClient();
		const result = await client.get(makeRequest(`${server.origin}/redirect`, { blockPrivateHosts: false }));

		assert.equal(result._tag, "ok");
		assert.equal(result.value.finalUrl, `${server.origin}/final`);
		assert.equal(result.value.body.toString("utf8"), "ok");
	} finally {
		await server.close();
	}
});

test("FetchPublicWebClient rejects private hosts before fetching", async () => {
	const client = new FetchPublicWebClient();
	const result = await client.get(makeRequest("http://localhost:9/", { blockPrivateHosts: true }));

	assert.equal(result._tag, "err");
	assert.equal(result.error._tag, "PrivateHostBlocked");
});

test("FetchPublicWebClient rejects IPv4-mapped IPv6 private hosts before fetching", async () => {
	const client = new FetchPublicWebClient();
	const result = await client.get(makeRequest("http://[::ffff:127.0.0.1]:9/", { blockPrivateHosts: true }));

	assert.equal(result._tag, "err");
	assert.equal(result.error._tag, "PrivateIpBlocked");
});

test("FetchPublicWebClient rejects redirects with URL credentials before fetching target", async () => {
	const server = await startServer((_request, response) => {
		response.writeHead(302, { location: "http://user:pass@example.com/secret" });
		response.end();
	});
	try {
		const client = new FetchPublicWebClient();
		const result = await client.get(makeRequest(server.origin, { blockPrivateHosts: false }));

		assert.equal(result._tag, "err");
		if (result._tag !== "err") {
			return;
		}
		assert.equal(result.error._tag, "UrlCredentialsUnsupported");
		assert.doesNotMatch(JSON.stringify(result.error), /user|pass/);
	} finally {
		await server.close();
	}
});

test("FetchPublicWebClient rejects oversized content-length and streamed bodies", async () => {
	const server = await startServer((request, response) => {
		if (request.url === "/length") {
			response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
			response.end();
			return;
		}
		response.writeHead(200, { "content-type": "text/plain" });
		response.write("123456");
		response.end();
	});
	try {
		const client = new FetchPublicWebClient();
		const tooLargeByLength = await client.get(
			makeRequest(`${server.origin}/length`, { blockPrivateHosts: false, maxResponseBytes: 5 }),
		);
		const tooLargeByBody = await client.get(
			makeRequest(`${server.origin}/body`, { blockPrivateHosts: false, maxResponseBytes: 5 }),
		);

		assert.equal(tooLargeByLength._tag, "err");
		assert.equal(tooLargeByLength.error._tag, "ResponseTooLarge");
		assert.equal(tooLargeByBody._tag, "err");
		assert.equal(tooLargeByBody.error._tag, "ResponseTooLarge");
	} finally {
		await server.close();
	}
});

test("FetchPublicWebClient retries Cloudflare challenge with fallback user agent and disposes both transports", async () => {
	const seenUserAgents: string[] = [];
	let closes = 0;
	const server = await startServer((request, response) => {
		seenUserAgents.push(request.headers["user-agent"] ?? "");
		if (request.headers["user-agent"] !== "fallback-agent") {
			response.writeHead(403, { "cf-mitigated": "challenge" });
			response.end("challenge");
			return;
		}
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("ok");
	});
	try {
		const client = new FetchPublicWebClient({
			dispatcherFactory: createTrackedDispatcherFactory(() => {
				closes += 1;
			}),
		});
		const result = await client.get(
			makeRequest(server.origin, { blockPrivateHosts: false, fallbackUserAgent: "fallback-agent" }),
		);

		assert.equal(result._tag, "ok");
		assert.deepEqual(seenUserAgents, ["default-agent", "fallback-agent"]);
		assert.equal(closes, 2);
	} finally {
		await server.close();
	}
});

function createPinnedAgent(records: readonly DnsRecord[]): Agent {
	return new Agent({
		connect: {
			lookup: ((_hostname, options, callback) => {
				if (typeof options === "object" && options.all) {
					callback(null, [...records]);
					return;
				}
				const record = records[0]!;
				callback(null, record.address, record.family);
			}) as import("node:net").LookupFunction,
		},
	});
}

function createTrackedDispatcherFactory(onClose: () => void): DispatcherFactory {
	return (records): Dispatcher => {
		const agent = createPinnedAgent(records);
		return {
			dispatch: agent.dispatch.bind(agent),
			close: async () => {
				onClose();
				await agent.close();
			},
			destroy: agent.destroy.bind(agent),
		} as Dispatcher;
	};
}

function makeRequest(
	url: string,
	overrides: { readonly blockPrivateHosts?: boolean; readonly maxResponseBytes?: number; readonly fallbackUserAgent?: string } = {},
): PublicWebRequest {
	const parsed = parsePublicHttpUrl(url);
	assert.equal(parsed._tag, "ok");
	return {
		url: parsed.value,
		accept: "text/plain",
		userAgent: "default-agent",
		fallbackUserAgent: overrides.fallbackUserAgent ?? "fallback-agent",
		maxRedirects: 5,
		maxResponseBytes: overrides.maxResponseBytes ?? 1024,
		blockPrivateHosts: overrides.blockPrivateHosts ?? true,
	};
}

async function startServer(
	handler: RequestHandler,
): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
	const server = createServer(handler);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address === "object");
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () => closeServer(server),
	};
}

async function closeServer(server: Server): Promise<void> {
	server.close();
	await once(server, "close");
}
