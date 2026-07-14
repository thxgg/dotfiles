import assert from "node:assert/strict";
import { test } from "node:test";
import { completionNotification, notificationContent } from "../notifications.ts";
import type { AgentJobSnapshot } from "../job-types.ts";

test("completion notification is typed, bounded, and references full results", () => {
  const job: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "search", source: "builtin", task: "inspect", cwd: "/tmp",
    status: "completed", background: true, backend: "herdr", startedAt: new Date().toISOString(),
    owner: { sessionId: "session-1" },
    result: {
      summary: "x".repeat(20_000), filesRead: [], filesChanged: [], validation: [], artifacts: [], toolCalls: [],
      usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 0, cost: 0.01, contextTokens: 40, turns: 2 },
    },
  };
  const notification = completionNotification(job);
  const content = notificationContent(job, notification);
  assert.equal(notification.kind, "completion");
  assert.ok(Buffer.byteLength(content, "utf8") < 14 * 1024);
  assert.match(content, /Agent action=result jobId=agent-deadbeef/);
});

test("final completion requires a complete self-contained parent response", () => {
  const job: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "reviewer", source: "builtin", task: "review", cwd: "/tmp",
    status: "completed", background: true, backend: "herdr", startedAt: new Date().toISOString(),
    owner: { sessionId: "session-1" },
    result: { summary: "One important finding.", filesRead: [], filesChanged: [], validation: [], artifacts: [], toolCalls: [] },
  };
  const content = notificationContent(job, completionNotification(job), 0);
  assert.match(content, /No background subagents remain active/);
  assert.match(content, /complete updated final response now/);
  assert.match(content, /reproduce the full self-contained deliverable/);
  assert.match(content, /do not merely acknowledge/);
});

test("non-final completion reports remaining active subagents", () => {
  const job: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "reviewer", source: "builtin", task: "review", cwd: "/tmp",
    status: "completed", background: true, backend: "herdr", startedAt: new Date().toISOString(),
    owner: { sessionId: "session-1" },
    result: { summary: "One important finding.", filesRead: [], filesChanged: [], validation: [], artifacts: [], toolCalls: [] },
  };
  const content = notificationContent(job, completionNotification(job), 2);
  assert.match(content, /2 background subagent\(s\) remain active/);
  assert.match(content, /wait to deliver the complete final response/);
  assert.doesNotMatch(content, /complete updated final response now/);
});

test("obsolete permission notifications do not masquerade as completion failures", () => {
  const job: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "agent", source: "builtin", task: "edit", cwd: "/tmp",
    status: "running", background: true, backend: "herdr", startedAt: new Date().toISOString(),
  };
  const content = notificationContent(job, { id: "permission-request-gone", kind: "permission", state: "pending", createdAt: new Date().toISOString() });
  assert.equal(content, "");
});

test("permission notification content remains bounded", () => {
  const job: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "agent", source: "builtin", task: "edit", cwd: "/tmp",
    status: "waiting", background: true, backend: "herdr", startedAt: new Date().toISOString(),
    permissionRequests: [{ id: "request-1", toolCallId: "tool-1", toolName: "bash", description: "x".repeat(512), input: {}, createdAt: new Date().toISOString() }],
  };
  const content = notificationContent(job, { id: "permission-request-1", kind: "permission", state: "pending", createdAt: new Date().toISOString() });
  assert.ok(Buffer.byteLength(content, "utf8") < 1024);
});

test("permission notification explains the explicit decision actions", () => {
  const job: AgentJobSnapshot = {
    id: "agent-deadbeef", agent: "agent", source: "builtin", task: "edit", cwd: "/tmp",
    status: "waiting", background: true, backend: "herdr", startedAt: new Date().toISOString(),
    permissionRequests: [{ id: "request-1", toolCallId: "tool-1", toolName: "bash", description: "Run tests", input: {}, createdAt: new Date().toISOString() }],
  };
  const content = notificationContent(job, { id: "permission-request-1", kind: "permission", state: "pending", createdAt: new Date().toISOString() });
  assert.match(content, /action=approve/);
  assert.match(content, /action=deny/);
});
