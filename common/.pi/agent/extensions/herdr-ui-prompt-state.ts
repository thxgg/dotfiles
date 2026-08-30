import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function herdrUiPromptState(pi: ExtensionAPI): void {
  pi.on("ui_prompt_start", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    pi.events.emit("herdr:blocked", {
      active: true,
      label: event.title ? `Waiting for user: ${event.title}` : "Waiting for user",
    });
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    pi.events.emit("herdr:blocked", { active: false });
  });
}
