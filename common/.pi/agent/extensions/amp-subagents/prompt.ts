import type { AgentDefinition } from "./agents.ts";
import { getActiveToolNames, getDisallowedToolNames } from "./agents.ts";

function permissionLabel(value: string | undefined): string {
  return value ?? "default";
}

export function composeAgentPrompt(agent: AgentDefinition): string {
  const metadata = [
    `Name: ${agent.name}`,
    `Return mode: ${agent.returnMode ?? "summary"}`,
    `Source: ${agent.source}`,
    agent.maxTurns ? `Max turns: ${agent.maxTurns}` : undefined,
  ].filter(Boolean).join("\n");
  const activeTools = getActiveToolNames(agent);
  const capabilityBoundary = [
    `- Edit: ${permissionLabel(agent.permissions.edit)}`,
    `- Write: ${permissionLabel(agent.permissions.write)}`,
    `- Bash: ${permissionLabel(agent.permissions.bash)}`,
    `- Active tools: ${activeTools?.join(", ") ?? "harness defaults"}`,
    `- Unavailable tools: ${getDisallowedToolNames(agent).join(", ") || "none"}`,
    "- Do not attempt operations that this boundary prohibits.",
    "- If execution or mutation is unavailable, inspect what you can and return the exact verification or mutation command for the parent to run.",
    "- A permission restriction is not a finding about the code or product.",
  ].join("\n");
  const completionBudget = [
    "- You have a fixed turn budget; reserve the final turn for a useful result.",
    "- Prioritize evidence that can change the parent's decision.",
    "- If the task is broader than the available budget, narrow it explicitly and state what remains.",
    "- Return partial findings rather than investigating until forced termination.",
    "- Never omit the final report solely because the investigation is incomplete.",
  ].join("\n");

  return [
    `# Subagent Definition\n${metadata}`,
    `# Capability Boundary\n${capabilityBoundary}`,
    `# Completion Budget\n${completionBudget}`,
    agent.systemPrompt,
    "# Parent/Child Contract\nYou are running as a child Pi session. Treat the parent Pi agent as your caller. Return the requested concise result; do not continue with unrelated work. Do not spawn other agents.",
  ].join("\n\n");
}
