import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "../agents.ts";
import { createChildResourceLoader } from "../in-process-runtime.ts";
import type { RuntimeJob } from "../job-types.ts";

test("delegated sessions load only the permission guard extension", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-child-loader-"));
  const extensionDir = path.join(cwd, ".pi", "extensions");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "nested.ts"), "export default function () { throw new Error('nested extension loaded'); }\n");

  try {
    const agent = discoverAgents(cwd, "builtin").agents.find((value) => value.name === "search")!;
    const job: RuntimeJob = {
      id: "agent-test0001",
      agent: agent.name,
      source: agent.source,
      task: "Inspect files",
      cwd,
      status: "queued",
      background: true,
      backend: "session",
      startedAt: new Date().toISOString(),
      attempt: 1,
      controller: new AbortController(),
    };
    const settings = SettingsManager.create(cwd, getAgentDir());
    const loader = createChildResourceLoader(job, agent, settings);

    await loader.reload();

    const result = loader.getExtensions();
    assert.equal(result.errors.length, 0);
    assert.equal(result.extensions.length, 1);
    assert.match(result.extensions[0]!.path, /^<inline:/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
