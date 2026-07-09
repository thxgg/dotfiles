import type { AgentDefinition } from "./agents.ts";

export function composeAgentPrompt(agent: AgentDefinition): string {
  const metadata = [
    `Name: ${agent.name}`,
    `Return mode: ${agent.returnMode ?? "summary"}`,
    `Source: ${agent.source}`,
    agent.maxTurns ? `Max turns: ${agent.maxTurns}` : undefined,
  ].filter(Boolean).join("\n");

  return [
    `# Subagent Definition\n${metadata}`,
    agent.systemPrompt,
    "# Parent/Child Contract\nYou are running as a child Pi session. Treat the parent Pi agent as your caller. Return the requested concise result; do not continue with unrelated work. Do not spawn other agents.",
  ].join("\n\n");
}
