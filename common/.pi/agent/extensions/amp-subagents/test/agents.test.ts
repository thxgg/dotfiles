import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverAgents, formatAgentList, getActiveToolNames, getAgentByName } from "../agents.ts";

test("discovers built-in Amp-style agents", () => {
  const agents = discoverAgents(process.cwd(), "builtin").agents;
  const names = agents.map((agent) => agent.name).sort();
  assert.deepEqual(names, ["agent", "check", "librarian", "oracle", "painter", "reviewer", "search"]);
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
