# web-tools

Pi extension that registers two public-web tools:

- `webfetch` — fetch one public URL as markdown, text, html, or an inline raster image
- `websearch` — search the public web for current information and candidate URLs

## Tools

### `webfetch`

Parameters:

- `url` — required
- `format` — optional: `markdown`, `text`, `html`
- `timeout` — optional timeout in seconds, clamped to `1..120`

Current defaults:

- `defaultFormat`: `markdown`
- `timeoutSeconds`: `30`
- `maxResponseBytes`: `5 MB`
- `blockPrivateHosts`: `true`
- `maxRedirects`: `5`
- `fallbackUserAgent`: `opencode`

Behavior notes:

- only `http://` and `https://` URLs are supported
- URL userinfo credentials (`https://user:pass@example.com`) are rejected and redacted in diagnostics
- private/local hosts and IPs are blocked by default
- byte signatures identify raster images (`png`, `jpeg`, `gif`, `webp`) before the declared Content-Type is used
- supported signatures return inline images with the detected MIME, even with a wrong or generic Content-Type
- image MIME claims without a supported signature are rejected; SVG remains text, never raster
- plausible BMP headers and PDF signatures are rejected even when declared as text; a `BM` prefix alone remains text
- signature checks identify formats; they do not fully decode or validate image files
- HTML is converted to markdown or text when requested
- binary content is rejected
- if a site returns `403` with `cf-mitigated: challenge`, the tool retries with the fallback user agent

### `websearch`

Parameters:

- `query` — required
- `maxResults` — optional, clamped to `1..20`
- `depth` — optional: `auto`, `fast`, `deep` (`deep` is accepted as a compatibility alias and mapped to `fast`)
- `livecrawl` — optional: `fallback` (default), `preferred`
- `contextMaxCharacters` — optional finite number, rounded and clamped to `1000..20000`; default `2000`

Current defaults:

- `enabled`: `true`
- `provider`: `exa`
- `endpoint`: configured in `settings.ts`
- `timeoutSeconds`: `25`
- `defaultMaxResults`: `8`
- `defaultDepth`: `auto`

Behavior notes:

- uses the configured Exa MCP-compatible endpoint
- Exa currently supports provider depths `auto` and `fast`; tool input `deep` is downgraded to `fast`
- search responses are limited to `1 MB`
- provider requests send the parsed `livecrawl` and `contextMaxCharacters` values
- invalid enums, non-number values, and non-finite numbers are rejected at the tool boundary
- result details include both controls

## Configuration

The extension has an internal settings shape:

```ts
{
  fetch: {
    defaultFormat: "markdown" | "text" | "html";
    timeoutSeconds: number;
    maxResponseBytes: number;
    blockPrivateHosts: boolean;
    maxRedirects: number;
    fallbackUserAgent: string;
  };
  search: {
    enabled: boolean;
    provider: "exa";
    endpoint: PublicHttpUrl;
    timeoutSeconds: number;
    defaultMaxResults: number;
    defaultDepth: "auto" | "fast" | "deep";
  };
}
```

But in the current implementation, these are hardcoded defaults in `settings.ts`.

That means:

- `webfetch.format` and `webfetch.timeout` can be overridden per call
- `websearch.maxResults`, `websearch.depth`, `websearch.livecrawl`, and `websearch.contextMaxCharacters` can be overridden per call
- fetch and search defaults are not exposed through Pi settings, extension settings, or env vars

To change the defaults, edit:

- `common/.pi/agent/extensions/web-tools/settings.ts`

## Source of truth

- extension entry: `common/.pi/agent/extensions/web-tools/index.ts`
- settings/defaults: `common/.pi/agent/extensions/web-tools/settings.ts`
- fetch Pi adapter: `common/.pi/agent/extensions/web-tools/webfetch.ts`
- fetch service: `common/.pi/agent/extensions/web-tools/fetch-page.ts`
- public web adapter: `common/.pi/agent/extensions/web-tools/network.ts`
- search Pi adapter: `common/.pi/agent/extensions/web-tools/websearch.ts`
- search service: `common/.pi/agent/extensions/web-tools/search-web.ts`
- Exa provider adapter: `common/.pi/agent/extensions/web-tools/providers/exa.ts`
- Exa protocol parser: `common/.pi/agent/extensions/web-tools/providers/exa-protocol.ts`
- Exa result parser: `common/.pi/agent/extensions/web-tools/providers/exa-results.ts`
- tool output projection: `common/.pi/agent/extensions/web-tools/tool-output.ts`
