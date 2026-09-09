import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWebFetchTool } from "./webfetch.ts";
import { createWebSearchTool } from "./websearch.ts";

// Stow deploys individual file links. Pi can evaluate this module at the link
// path, before the optional sibling extension has been deployed.
export async function loadFocusAdapter(ownerUrl: string) {
	try {
		const ownerPath = realpathSync(fileURLToPath(ownerUrl));
		const adapterPath = resolve(dirname(ownerPath), "../focus-mode/adapter.ts");
		if (!existsSync(adapterPath)) return undefined;
		return await import(pathToFileURL(adapterPath).href) as typeof import("../focus-mode/adapter.ts");
	} catch {
		// Optional UI integration must never prevent the original tools loading.
		return undefined;
	}
}

export default async function webToolsExtension(pi: ExtensionAPI) {
	const adapter = await loadFocusAdapter(import.meta.url);
	const fetch = createWebFetchTool();
	const search = createWebSearchTool();
	pi.registerTool(adapter ? adapter.withFocusRendering(pi, fetch) : fetch);
	pi.registerTool(adapter ? adapter.withFocusRendering(pi, search) : search);
	if (adapter) {
		const dispose = adapter.announceFocusTools(pi, ["webfetch", "websearch"], import.meta.url);
		pi.on("session_shutdown", dispose);
	}
}
