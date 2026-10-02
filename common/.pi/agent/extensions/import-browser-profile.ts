import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { importBrowserProfile, type ImportOptions } from "../lib/import-browser-profile.ts";

const widgetKey = "import-browser-profile";

/** Run the import with a visible stage indicator and clear it on every exit path. */
export async function runBrowserProfileImport(
	options: ImportOptions,
	ui: Pick<ExtensionContext["ui"], "setWidget" | "notify">,
): Promise<void> {
	try {
		ui.setWidget(widgetKey, ["Importing Helium profile: starting..."]);
		const result = await importBrowserProfile({
			...options,
			onProgress(stage) {
				ui.setWidget(widgetKey, [`Importing Helium profile: ${stage}...`]);
			},
		});
		ui.notify(
			result.ok
				? "Helium profile imported. New Agent Browser sessions will use the copy. You can reopen Helium."
				: result.message,
			result.ok ? "info" : "error",
		);
	} catch {
		ui.notify("Helium import stopped unexpectedly. Run /import-browser-profile again.", "error");
	} finally {
		ui.setWidget(widgetKey, undefined);
	}
}

/** Register a manual, local-only Helium profile import. No work runs at startup. */
export default function browserProfileImport(pi: ExtensionAPI): void {
	let importing = false;
	pi.registerCommand("import-browser-profile", {
		description: "Copy your closed Helium profile for new Agent Browser sessions",
		async handler(_args, ctx) {
			if (importing) {
				ctx.ui.notify("A Helium import is already running. Wait for it to finish.", "warning");
				return;
			}
			importing = true;
			try {
				const home = homedir();
				await runBrowserProfileImport({
					home,
					configHome: process.env.XDG_CONFIG_HOME || join(home, ".config"),
					platform: process.platform,
					procRoot: "/proc",
					executable: "/opt/helium-browser-bin/helium",
				}, ctx.ui);
			} finally {
				importing = false;
			}
		},
	});
}
