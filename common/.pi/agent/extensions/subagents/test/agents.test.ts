import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverAgents, formatAgentList, getActiveToolNames, getAgentByName, getDisallowedToolNames } from "../agents.ts";
import { composeAgentPrompt } from "../prompt.ts";

test("discovers built-in Pi agents", () => {
  const agents = discoverAgents(process.cwd(), "builtin").agents;
  const names = agents.map((agent) => agent.name).sort();
  assert.deepEqual(names, ["agent", "check", "fable-reviewer", "frontend-reviewer", "librarian", "oracle", "painter", "reviewer", "search"]);
});

test("frontend reviewer uses the scoped GLM model", () => {
  const agents = discoverAgents(process.cwd(), "builtin").agents;
  const frontendReviewer = getAgentByName(agents, "frontend-reviewer");
  assert.ok(frontendReviewer);
  assert.equal(frontendReviewer.model, "opencode/glm-5.2");
  assert.deepEqual(getActiveToolNames(frontendReviewer), ["read", "grep", "find", "ls", "bash"]);
  assert.deepEqual(frontendReviewer.permissions, { edit: "deny", write: "deny", bash: "readonly" });
});

test("hidden agents are callable by name but omitted from default lists", () => {
  const agents = discoverAgents(process.cwd(), "builtin").agents;
  assert.equal(getAgentByName(agents, "check")?.hidden, true);
  assert.equal(formatAgentList(agents).includes("check"), false);
  assert.equal(formatAgentList(agents, true).includes("check"), true);
});

test("permissions remove denied tools from active tool allowlist", () => {
  const agents = discoverAgents(process.cwd(), "builtin").agents;
  const painter = getAgentByName(agents, "painter");
  assert.ok(painter);
  assert.deepEqual(getActiveToolNames(painter), ["read", "ls", "generate_image"]);

  const search = getAgentByName(agents, "search");
  assert.ok(search);
  assert.deepEqual(getActiveToolNames(search), ["read", "grep", "find", "ls", "bash"]);
});

test("composed prompts expose capability and completion boundaries", () => {
  const reviewer = getAgentByName(discoverAgents(process.cwd(), "builtin").agents, "reviewer")!;
  const prompt = composeAgentPrompt(reviewer);
  assert.match(prompt, /# Capability Boundary/);
  assert.match(prompt, /- Edit: deny/);
  assert.match(prompt, /- Bash: readonly/);
  assert.match(prompt, /Unavailable tools: Agent, edit, write/);
  assert.match(prompt, /return the exact verification or mutation command for the parent/);
  assert.match(prompt, /# Completion Budget/);
  assert.match(prompt, /reserve the final turn for a useful result/);
  assert.match(prompt, /Return partial findings rather than investigating until forced termination/);
});

test("librarian instructions sequence source and official docs before web search", () => {
  const librarian = getAgentByName(discoverAgents(process.cwd(), "builtin").agents, "librarian")!;
  assert.ok(librarian.systemPrompt.indexOf("Call repo_cache") < librarian.systemPrompt.indexOf("Consult known official documentation URLs"));
  assert.ok(librarian.systemPrompt.indexOf("Consult known official documentation URLs") < librarian.systemPrompt.indexOf("Use websearch for discovery only"));
});

test("disallowed tools apply even without an allowlist", () => {
  const base = discoverAgents(process.cwd(), "builtin").agents[0];
  assert.ok(base);
  const agent = {
    ...base,
    tools: undefined,
    disallowedTools: ["webfetch"],
    permissions: { edit: "deny" as const, write: "deny" as const, bash: "deny" as const },
  };
  assert.equal(getActiveToolNames(agent), undefined);
  assert.deepEqual(getDisallowedToolNames(agent), ["Agent", "bash", "edit", "webfetch", "write"]);
});
