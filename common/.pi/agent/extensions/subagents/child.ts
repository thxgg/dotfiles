import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createStructuredOutputTool, STRUCTURED_OUTPUT_INSTRUCTION } from "./structured-output.ts";

export default function childExtension(pi: ExtensionAPI): void {
  const runDir = process.env.PI_SUBAGENT_RUN_DIR;
  if (!runDir) return;
  const schemaPath = join(runDir, "schema.json");
  if (existsSync(schemaPath)) {
    const schema: unknown = JSON.parse(readFileSync(schemaPath, "utf8"));
    pi.registerTool(createStructuredOutputTool(schema, (value) => {
      writeFileSync(join(runDir, "structured.json"), JSON.stringify(value), { mode: 0o600 });
    }));
  }
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nComplete only the assigned task. Do not spawn subagents or workflows.\n${existsSync(schemaPath) ? STRUCTURED_OUTPUT_INSTRUCTION : ""}`,
  }));
  pi.on("tool_call", (event) => {
    if (["Agent", "subagent", "workflow", "ask_user"].includes(event.toolName)) return { block: true, reason: "Nested delegation and interactive questions are disabled in headless children. Report missing input in your result." };
  });
}
