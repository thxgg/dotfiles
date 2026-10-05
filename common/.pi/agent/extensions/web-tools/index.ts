import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWebFetchTool } from "./webfetch.ts";
import { createWebSearchTool } from "./websearch.ts";

/** Register web tools independently from transcript presentation extensions. */
export default function webToolsExtension(pi: ExtensionAPI): void {
	pi.registerTool(createWebFetchTool());
	pi.registerTool(createWebSearchTool());
}
