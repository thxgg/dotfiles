import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverAgents, formatAgentList, getActiveToolNames, getAgentByName, getDisallowedToolNames } from "../agents.ts";

test("discovers built-in Amp-style agents", () => {
  const agents = discoverAgents(process.cwd(), "builtin").agents;
  const names = agents.map((agent) => agent.name).sort();
  assert.deepEqual(names, ["agent", "check", "frontend-reviewer", "librarian", "oracle", "painter", "reviewer", "search"]);
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

test("disallowed tools apply even without an allowlist", () => {
  const agent = {
    ...discoverAgents(process.cwd(), "builtin").agents[0],
    tools: undefined,
    disallowedTools: ["webfetch"],
    permissions: { edit: "deny" as const, write: "deny" as const, bash: "deny" as const },
  };
  assert.equal(getActiveToolNames(agent), undefined);
  assert.deepEqual(getDisallowedToolNames(agent), ["Agent", "bash", "edit", "webfetch", "write"]);
});
