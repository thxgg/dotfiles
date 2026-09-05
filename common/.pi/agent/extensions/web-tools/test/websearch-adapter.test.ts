import test from "node:test";
import assert from "node:assert/strict";
import { err, ok, type Result } from "../result.ts";
import { SearchWeb } from "../search-web.ts";
import { createWebSearchTool } from "../websearch.ts";
import { parsePublicHttpUrl } from "../types.ts";
import type { WebToolsSettings } from "../types.ts";
import type { ToolOutputStore, ToolOutputStoreError } from "../tool-output.ts";
import type { NormalizedSearchResult, SearchProvider, SearchProviderError, SearchProviderRequest } from "../providers/types.ts";

const endpoint = parsePublicHttpUrl("https://example.test/mcp");
assert.equal(endpoint._tag, "ok");

const settings: WebToolsSettings = {
	fetch: {
		defaultFormat: "markdown",
		timeoutSeconds: 30,
		maxResponseBytes: 5 * 1024 * 1024,
		blockPrivateHosts: true,
		maxRedirects: 5,
		fallbackUserAgent: "opencode",
	},
	search: {
		enabled: true,
		provider: "exa",
		endpoint: endpoint.value,
		timeoutSeconds: 25,
		defaultMaxResults: 8,
		defaultDepth: "auto",
	},
};

class FakeProvider implements SearchProvider {
	readonly name = "exa" as const;
	readonly requests: SearchProviderRequest[] = [];

	constructor(private readonly response: Result<readonly NormalizedSearchResult[], SearchProviderError>) {}

	async search(
		input: SearchProviderRequest,
		_options?: { readonly signal?: AbortSignal },
	): Promise<Result<readonly NormalizedSearchResult[], SearchProviderError>> {
		this.requests.push(input);
		return this.response;
	}
}

class UnusedOutputStore implements ToolOutputStore {
	async writeTextFile(
		_prefix: string,
		_fileName: string,
		_content: string,
	): Promise<Result<string, ToolOutputStoreError>> {
		return ok("/tmp/unused.txt");
	}
}

test("websearch propagates default and explicit controls to requests and details", async () => {
	const provider = new FakeProvider(ok([]));
	const searchWeb = new SearchWeb({ settings: settings.search, provider });
	const tool = createWebSearchTool({ settings, searchWeb, outputStore: new UnusedOutputStore() });
	assert.ok(tool.parameters.properties.livecrawl);
	assert.ok(tool.parameters.properties.contextMaxCharacters);
	for (const params of [{ query: "example" }, { query: "example", livecrawl: "preferred", contextMaxCharacters: 99999 }]) {
		const result = await tool.execute("id", params);
		const expectedCrawl = params.livecrawl ?? "fallback";
		const expectedContext = params.contextMaxCharacters ? 20000 : 2000;
		assert.equal(result.details.livecrawl, expectedCrawl);
		assert.equal(result.details.contextMaxCharacters, expectedContext);
		assert.equal(provider.requests.at(-1)?.livecrawl, expectedCrawl);
		assert.equal(provider.requests.at(-1)?.contextMaxCharacters, expectedContext);
	}
	const before = provider.requests.length;
	await assert.rejects(tool.execute("id", { query: "example", contextMaxCharacters: Infinity }), /finite number/);
	await assert.rejects(tool.execute("id", { query: "example", livecrawl: "invalid" }), /fallback, preferred/);
	assert.equal(provider.requests.length, before);
});

test("websearch execute throws safe message for provider protocol failures", async () => {
	const searchWeb = new SearchWeb({
		settings: settings.search,
		provider: new FakeProvider(
			err({
				_tag: "SearchProviderProtocolInvalid",
				provider: "exa",
				reason: "missing result content raw details",
			}),
		),
	});
	const tool = createWebSearchTool({ settings, searchWeb, outputStore: new UnusedOutputStore() });

	await assert.rejects(
		tool.execute("id", { query: "example" }),
		/Search provider returned an invalid response/,
	);
});
