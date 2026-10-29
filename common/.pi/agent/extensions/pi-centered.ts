import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Load the local pi-centered adaptation through either a source or Stow leaf path. */
export default async function (pi: ExtensionAPI) {
  const sourceDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
  const extension: typeof import("../lib/pi-centered/index.ts") = await import(
    pathToFileURL(resolve(sourceDir, "../lib/pi-centered/index.ts")).href
  );
  extension.default(pi);
}
