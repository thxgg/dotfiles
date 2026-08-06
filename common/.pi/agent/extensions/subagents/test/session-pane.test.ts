import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandExecutor, CommandResult } from "../herdr-client.ts";
import { openSessionPane } from "../session-pane.ts";

class FakeExecutor implements CommandExecutor {
  calls: string[][] = [];
  constructor(private responses: CommandResult[]) {}
  async run(_command: string, args: string[]): Promise<CommandResult> { this.calls.push(args); return this.responses.shift() ?? { code: 0, stdout: "", stderr: "" }; }
}
function ok(result: unknown): CommandResult { return { code: 0, stdout: JSON.stringify({ id: "test", result }), stderr: "" }; }

const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv;

test("openSessionPane focuses an existing pane with the exact session path", async () => {
  const executor = new FakeExecutor([
    ok({ type: "agent_list", agents: [{ pane_id: "w1:p9", agent_session: { kind: "path", value: "/tmp/child.jsonl" } }] }),
    ok({ type: "agent_info", agent: { pane_id: "w1:p9" } }),
  ]);
  const result = await openSessionPane({ sessionFile: "/tmp/child.jsonl", cwd: "/tmp", label: "child", env, executor });
  assert.deepEqual(result, { paneId: "w1:p9", reused: true });
  assert.deepEqual(executor.calls, [["agent", "list"], ["agent", "focus", "w1:p9"]]);
});

test("openSessionPane creates a pane only when the session is not open", async () => {
  const executor = new FakeExecutor([
    ok({ type: "agent_list", agents: [] }),
    ok({ type: "pane_split", pane: { pane_id: "w1:p2" } }),
    { code: 0, stdout: "", stderr: "" },
    ok({ type: "pane_info", pane: { pane_id: "w1:p2", agent_session: { kind: "path", value: "/tmp/child path.jsonl" } } }),
    ok({ type: "agent_info", agent: { pane_id: "w1:p2" } }),
  ]);
  const result = await openSessionPane({ sessionFile: "/tmp/child path.jsonl", cwd: "/repo", label: "agent-deadbeef", env, executor });
  assert.deepEqual(result, { paneId: "w1:p2", reused: false });
  assert.deepEqual(executor.calls[1], ["pane", "split", "w1:p1", "--direction", "right", "--cwd", "/repo", "--no-focus"]);
  assert.deepEqual(executor.calls[2], ["pane", "run", "w1:p2", "sh -lc 'pi --session '\"'\"'/tmp/child path.jsonl'\"'\"' --approve; status=$?; herdr pane close '\"'\"'w1:p2'\"'\"' >/dev/null 2>&1 || true; exit $status'"]);
  assert.deepEqual(executor.calls[3], ["pane", "get", "w1:p2"]);
  assert.deepEqual(executor.calls[4], ["agent", "focus", "w1:p2"]);
});

test("openSessionPane requires Herdr only when the user opens a session", async () => {
  await assert.rejects(openSessionPane({ sessionFile: "/tmp/child.jsonl", cwd: "/tmp", label: "child", env: {}, executor: new FakeExecutor([]) }), /requires a Herdr-managed/);
});
