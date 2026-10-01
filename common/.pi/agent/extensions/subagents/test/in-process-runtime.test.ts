import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { discoverAgents, getActiveToolNames, getDisallowedToolNames } from "../agents.ts";
import { createChildResourceLoader } from "../in-process-runtime.ts";
import { bindChildSessionExtensions, shutdownAndDisposeChildSession } from "../child-lifecycle.ts";
import type { RuntimeJob } from "../job-types.ts";

const cases = [
  { name: "search keeps only the permission guard", agentName: "search", denyImage: false, rename: false, imageAvailable: false },
  { name: "Painter receives generate_image without the parent extension stack", agentName: "painter", denyImage: false, rename: false, imageAvailable: true },
  { name: "explicitly denied generate_image is not registered", agentName: "painter", denyImage: true, rename: false, imageAvailable: false },
  { name: "image capability follows allowed tools rather than the agent name", agentName: "painter", denyImage: false, rename: true, imageAvailable: true },
];

for (const scenario of cases) {
  test(scenario.name, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-child-loader-"));
    const extensionDir = path.join(cwd, ".pi", "extensions");
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.writeFileSync(path.join(extensionDir, "nested.ts"), "export default function () { throw new Error('nested extension loaded'); }\n");

    try {
      const builtin = discoverAgents(cwd, "builtin").agents.find((value) => value.name === scenario.agentName);
      assert.ok(builtin);
      const agent = {
        ...builtin,
        name: scenario.rename ? "custom-image-agent" : builtin.name,
        disallowedTools: scenario.denyImage ? ["generate_image"] : [],
      };
      const job: RuntimeJob = {
        id: "agent-00000001",
        agent: agent.name,
        source: agent.source,
        task: "Check child tool registration without model or image requests",
        cwd,
        status: "queued",
        background: true,
        backend: "session",
        startedAt: new Date().toISOString(),
        attempt: 1,
        controller: new AbortController(),
      };
      const settings = SettingsManager.inMemory();
      const loader = createChildResourceLoader(job, agent, settings);
      await loader.reload();

      const result = loader.getExtensions();
      assert.deepEqual(result.errors, []);
      assert.equal(result.extensions.length, scenario.imageAvailable ? 2 : 1);
      for (const extension of result.extensions) assert.match(extension.path, /^<inline:/);
      const registeredTools = result.extensions.flatMap((extension) => [...extension.tools.keys()]);
      assert.deepEqual(registeredTools, scenario.imageAvailable ? ["generate_image"] : []);

      const modelRuntime = await ModelRuntime.create({
        authPath: path.join(cwd, "auth.json"),
        modelsPath: path.join(cwd, "models.json"),
      });
      const { session } = await createAgentSession({
        cwd,
        agentDir: cwd,
        settingsManager: settings,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
        modelRuntime,
        tools: getActiveToolNames(agent),
        excludeTools: getDisallowedToolNames(agent),
      });
      try {
        await bindChildSessionExtensions(session);
        const active = session.getActiveToolNames();
        assert.equal(active.includes("generate_image"), scenario.imageAvailable);
        assert.equal(active.includes("Agent"), false);
        if (scenario.agentName === "painter") {
          assert.deepEqual([...active].sort(), scenario.imageAvailable ? ["generate_image", "ls", "read"] : ["ls", "read"]);
        }
      } finally {
        await shutdownAndDisposeChildSession(session);
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
}
