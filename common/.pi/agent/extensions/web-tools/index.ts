import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWebFetchTool } from "./webfetch.ts";
import { createWebSearchTool } from "./websearch.ts";

/** Register native web tools; display-only grouping is on unless explicitly disabled. */
export default async function webToolsExtension(pi: ExtensionAPI): Promise<void> {
	const fetch = createWebFetchTool();
	const search = createWebSearchTool();
	if (process.env.PI_VERBOSITY_WEB === "0") {
		pi.registerTool(fetch);
		pi.registerTool(search);
		return;
	}
	const { withVerbosityRendering, announceVerbosityTools } = await import("../verbosity-level/adapter.ts");
	pi.registerTool(withVerbosityRendering(pi, fetch));
	pi.registerTool(withVerbosityRendering(pi, search));
	const dispose = announceVerbosityTools(pi, [fetch.name, search.name], import.meta.url);
	pi.on("session_shutdown", dispose);
}
