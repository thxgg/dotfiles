import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** T3 Code sets this only for Pi sessions that receive its MCP tools, including html_render. */
const T3_MCP_URL_ENV = "T3_MCP_URL";
/** Test override. Normal installs read the guide that Stow links beside this extension. */
const GUIDE_PATH_ENV = "T3_VISUAL_GUIDE_PATH";
const SECTION = "t3_visual_guide";
const DEFAULT_GUIDE = new URL("../t3/visual-guide.md", import.meta.url);

function readGuide(): { text?: string; error?: string } {
  const path = process.env[GUIDE_PATH_ENV] || DEFAULT_GUIDE;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text ? { text } : { error: `${String(path)} is empty` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Add the T3 visual design guide to the system prompt, only inside T3 Code sessions. */
export default function t3VisualGuide(pi: ExtensionAPI): void {
  // The TUI and other hosts never set this, so they get no handler and no prompt change.
  if (!process.env[T3_MCP_URL_ENV]) return;

  let warned = false;
  pi.on("before_agent_start", (event, ctx) => {
    // Read on each run so guide edits apply without a Pi restart.
    const guide = readGuide();
    if (!guide.text) {
      if (!warned) {
        warned = true;
        ctx.ui.notify(`T3 visual guide unavailable: ${guide.error}`, "warning");
      }
      return undefined;
    }
    const options = event.systemPromptOptions;
    if (options.forceSystemPrompt === undefined) {
      // A named section keeps the guide replaceable and separate from T3's own section.
      options.sections[SECTION] = guide.text;
      return undefined;
    }
    // An earlier handler replaced the whole prompt, so sections no longer render.
    return { systemPrompt: `${event.systemPrompt}\n\n${guide.text}` };
  });
}
