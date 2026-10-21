import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { runWorkflowSandbox } from "../../workflows/sandbox.ts";
import { WorkflowController } from "../../workflows/controller.ts";
import { enqueue, inboxDir, launchRun, listRuns, readMetadata, stopRun, writeMetadata, type RunMetadata } from "../shared.ts";
import { setTimeout as delay } from "node:timers/promises";
import { runChildTask } from "../runtime.ts";

async function until<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = read(); if (value) return value; await delay(50); }
  throw new Error("Timed out waiting for child");
}

// A real Pi child, with an offline provider. No credentials, network, shell tools, or live HOME.
const provider = `import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
export default function(pi) {
  pi.registerCommand('fixture-reload', { description: 'Reload for lifecycle testing', handler: async (_args, ctx) => { await ctx.reload(); } });
  pi.registerCommand('fixture-dialog', { description: 'Unsupported headless input', handler: async (_args, ctx) => { await ctx.ui.confirm('Confirm', 'Allow?'); } });
  pi.registerCommand('fixture-crash', { description: 'Synthetic process failure', handler: async () => { process.exit(7); } });
  pi.registerProvider('fixture', {
    baseUrl: 'http://invalid.test', apiKey: 'fixture', api: 'openai-completions',
    models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 }],
    streamSimple(model, context) {
      const stream = new AssistantMessageEventStream();
      const user = context.messages.filter(m => m.role === 'user').at(-1);
      const text = typeof user?.content === 'string' ? user.content : user?.content?.filter(p => p.type === 'text').map(p => p.text).join('');
      const message = { role: 'assistant', content: [{ type: 'text', text: 'reply:' + text }],
        api: model.api, provider: model.provider, model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop', timestamp: Date.now() };
      const lastUserIndex = context.messages.findLastIndex(m => m.role === 'user');
      const result = context.messages.slice(lastUserIndex + 1).findLast(m => m.role === 'toolResult');
      const tools = context.tools?.map(t => t.name) ?? [];
      if (text.includes('inspect-tools')) message.content = [{ type: 'text', text: JSON.stringify(tools) }];
      const operations = {
        'read-file': ['read', { path: 'input.txt' }],
        'write-file': ['write', { path: 'output.txt', content: 'written by fixture' }],
        'bash-check': ['bash', { command: 'printf fixture-shell' }],
        'codemode-check': ['codemode', { code: 'text(await tools.read({path: "input.txt"}));' }],
      };
      const operation = operations[text.replace(/^Task:\\n/, '').trim()];
      if (operation && !result) {
        message.content = [{ type: 'toolCall', id: 'operation-1', name: operation[0], arguments: operation[1] }];
        message.stopReason = 'toolUse';
      } else if (operation && result) message.content = [{ type: 'text', text: JSON.stringify(result.content) }];
      if (text === 'structured') { message.content = [{ type: 'toolCall', id: 'result-1', name: 'structured_output', arguments: { answer: 42 } }]; message.stopReason = 'toolUse'; }
      if (text === 'failure') { message.stopReason = 'error'; message.errorMessage = 'Synthetic provider failure'; }
      setTimeout(() => {
        if (text === 'failure') stream.push({ type: 'error', reason: 'error', error: message });
        else stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      }, text.includes('very-slow') ? 2500 : text.includes('slow') ? 1000 : 10);
      return stream;
    }
  });
}`;

test("real headless runtime and common user workflows", { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagent-runtime-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  // Place the fixture under the workspace so Pi can resolve the installed SDK.
  const fixture = fileURLToPath(new URL(`./fixture-${process.pid}.ts`, import.meta.url));
  writeFileSync(fixture, provider);
  const before = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, PI_OFFLINE: process.env.PI_OFFLINE, XDG_STATE_HOME: process.env.XDG_STATE_HOME };
  process.env.HOME = root; process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = "1"; process.env.XDG_STATE_HOME = join(root, "state");
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ extensions: [fixture], defaultTools: [], retry: { enabled: false } }));
  const runDir = join(root, "run");
  mkdirSync(inboxDir(runDir), { recursive: true });
  const now = new Date().toISOString();
  const run: RunMetadata = { version: 1, handle: "aabbcc", parentPid: process.pid, runDir, sessionFile: join(runDir, "session.jsonl"), cwd: root,
    provider: "fixture", model: "fixture", thinking: "off", state: "starting", hasStarted: false, createdAt: now, updatedAt: now,
    launchArgs: ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp", "--offline", "--no-tools", "-e", fixture] };
  writeFileSync(run.sessionFile, ""); writeMetadata(run);
  try {
    enqueue(runDir, { message: "first", delivery: "auto" });
    await launchRun(run);
    const first = await until(() => { const value = readMetadata(runDir); if (value?.state === "error") throw new Error(readFileSync(join(runDir, "supervisor.log"), "utf8") + value.error); return value?.completedAt ? value : undefined; });
    assert.equal(first.state, "idle");
    assert.match(readFileSync(run.sessionFile, "utf8"), /reply:first/);
    enqueue(runDir, { message: "second", delivery: "followUp" });
    await until(() => { const value = readMetadata(runDir); return value?.completedAt !== first.completedAt && value?.state === "idle" ? value : undefined; });
    assert.match(readFileSync(run.sessionFile, "utf8"), /reply:second/);
    enqueue(runDir, { message: "slow active task", delivery: "auto" });
    await until(() => readMetadata(runDir)?.state === "busy" ? true : undefined);
    enqueue(runDir, { message: "queued follow-up", delivery: "followUp" });
    await until(() => readMetadata(runDir)?.state === "idle" && readFileSync(run.sessionFile, "utf8").includes("reply:queued follow-up") ? true : undefined);
    await stopRun(readMetadata(runDir)!, true);
    assert.equal(readMetadata(runDir)?.suspended, true);
    await launchRun(readMetadata(runDir)!);
    await until(() => readMetadata(runDir)?.state === "idle" ? true : undefined);
    assert.equal(readMetadata(runDir)?.childSessionId, first.childSessionId);
    enqueue(runDir, { message: "third", delivery: "auto" });
    await until(() => readFileSync(run.sessionFile, "utf8").includes("reply:third") ? true : undefined);

    // Exercise the workflow adapter against the same real subprocess transport.
    const task = { prompt: "workflow", cwd: root, provider: "fixture", model: "fixture", thinking: "off", parentSessionId: "test-parent", signal: new AbortController().signal };
    const normal = await runChildTask(task);
    assert.equal(normal.ok, true, normal.error);
    assert.match(normal.output, /reply:workflow/);
    const structured = await runChildTask({ ...task, prompt: "structured", schema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"], additionalProperties: false } });
    assert.equal(structured.ok, true, structured.error);
    assert.deepEqual(structured.structured, { answer: 42 });
    const missing = await runChildTask({ ...task, schema: { type: "object" } });
    assert.equal(missing.ok, false);
    assert.match(missing.error!, /required structured output/);
    const failure = await runChildTask({ ...task, prompt: "failure" });
    assert.equal(failure.ok, false);
    assert.match(failure.error!, /Synthetic provider failure/);
    const cancellation = new AbortController();
    const cancelled = runChildTask({ ...task, prompt: "slow", signal: cancellation.signal });
    const abortTimer = setTimeout(() => cancellation.abort(), 1000);
    const cancelledResult = await cancelled;
    clearTimeout(abortTimer);
    assert.equal(cancelledResult.ok, false);
    assert.match(cancelledResult.error!, /cancelled/);

    const cli = fileURLToPath(new URL('../subagent.ts', import.meta.url));
    const cliEnv = { ...process.env, PI_SESSION_ID: 'cli-parent', PI_PROVIDER: 'fixture', PI_MODEL: 'fixture', PI_REASONING_LEVEL: 'off', PI_SUBAGENT_PARENT_PID: String(process.pid), BASH_ENV: '', ENV: '' };
    async function command(args: string[], env = cliEnv) {
      const child = spawn(process.execPath, [cli, ...args], { cwd: root, env });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
      const code = await new Promise(resolve => child.on('close', resolve));
      return { code, stdout, stderr };
    }
    async function cliSpawn(prompt: string, extra: string[] = []) {
      const result = await command(['spawn', '--name', 'test-run', '--prompt', prompt, ...extra]);
      assert.equal(result.code, 0, result.stderr);
      const handle = /test-run \(([a-f0-9]+)\)/.exec(result.stdout)?.[1];
      assert.ok(handle, result.stdout);
      return handle;
    }
    await t.test('invalid CLI arguments fail before state mutation', async () => {
      const before = listRuns().length;
      for (const args of [
        ['spawn', '--prompt', '   '], ['spawn', '--prompt', 'x', '--tools', ',,'],
        ['spawn', '--prompt', 'x', '--thinking', 'invalid'], ['spawn', '--file', join(root, 'missing')],
        ['status', '../escape'],
      ]) assert.equal((await command(args)).code, 1);
      assert.equal(listRuns().length, before);
    });
    await t.test('headless dialogs fail clearly instead of hanging or approving', async () => {
      const result = await runChildTask({ ...task, prompt: '/fixture-dialog' });
      assert.equal(result.ok, false);
      assert.match(result.error!, /interactive input/);
    });
    await t.test('unexpected child exit returns an error rather than hanging', async () => {
      const result = await runChildTask({ ...task, prompt: '/fixture-crash' });
      assert.equal(result.ok, false);
      assert.match(result.error!, /exited.*code=7/);
    });
    await t.test('CLI composes files and prompts, inherits model, renames, waits and deletes only its run', async () => {
      writeFileSync(join(root, 'task brief.txt'), 'FILE_MARKER');
      const handle = await cliSpawn('PROMPT_ONE', ['--file', join(root, 'task brief.txt'), '--prompt', 'PROMPT_TWO', '--cwd', root]);
      const settled = await command(['wait', handle, '--timeout', '10']);
      assert.equal(settled.code, 0, settled.stderr);
      for (const marker of ['FILE_MARKER', 'PROMPT_ONE', 'PROMPT_TWO']) assert.ok(settled.stdout.includes(marker));
      const metadata = listRuns('cli-parent').find(run => run.handle === handle)!;
      assert.equal(metadata.provider, 'fixture'); assert.equal(metadata.model, 'fixture'); assert.equal(metadata.thinking, 'off');
      assert.equal((await command(['rename', handle, 'renamed run'])).code, 0);
      assert.match((await command(['list'])).stdout, /renamed run/);
      assert.equal((await command(['stop', handle], { ...cliEnv, PI_SESSION_ID: 'other-parent' })).code, 1);
      assert.ok(readMetadata(metadata.runDir));
      assert.equal((await command(['stop', handle])).code, 0);
      assert.equal(readMetadata(metadata.runDir), undefined);
    });
    await t.test('CLI wait timeout leaves a child alive; steering and queued follow-ups finish', async () => {
      const handle = await cliSpawn('very-slow');
      const timeout = await command(['wait', handle, '--timeout', '1']);
      assert.equal(timeout.code, 1); assert.match(timeout.stderr, /Timed out/);
      assert.match((await command(['status', handle])).stdout, /busy/);
      assert.equal((await command(['send', handle, 'steer-marker'])).code, 0);
      assert.equal((await command(['send', handle, '--follow-up', 'followup-marker'])).code, 0);
      const settled = await command(['wait', handle, '--timeout', '10']);
      assert.equal(settled.code, 0, settled.stderr); assert.match(settled.stdout, /followup-marker/);
      await command(['stop', handle]);
    });
    await t.test('actual read, write, bash and codemode calls stay inside the temporary workspace', async () => {
      writeFileSync(join(root, 'input.txt'), 'READ_MARKER');
      for (const [prompt, tools, expected] of [
        ['read-file', 'read', 'READ_MARKER'], ['write-file', 'write', 'Successfully'],
        ['bash-check', 'bash', 'fixture-shell'], ['codemode-check', 'read,codemode', 'READ_MARKER'],
      ]) {
        const handle = await cliSpawn(prompt!, ['--tools', tools!]);
        const result = await command(['wait', handle, '--timeout', '10']);
        assert.equal(result.code, 0, result.stderr); assert.ok(result.stdout.includes(expected!), result.stdout);
        await command(['stop', handle]);
      }
      assert.equal(readFileSync(join(root, 'output.txt'), 'utf8'), 'written by fixture');
      const handle = await cliSpawn('inspect-tools', ['--tools', 'read,grep,find,ls']);
      const result = await command(['wait', handle, '--timeout', '10']);
      assert.equal(result.code, 0, result.stderr);
      assert.ok(!result.stdout.includes('"write"')); assert.ok(!result.stdout.includes('"bash"')); assert.ok(!result.stdout.includes('"workflow"'));
      await command(['stop', handle]);
    });
    await t.test('sandbox runs parallel reviews then passes their results into synthesis', async () => {
      const controller = new WorkflowController();
      const phases: string[] = [];
      try {
        const result = await runWorkflowSandbox({
          source: `const reviews = await phase('Review', () => parallel([() => agent('review-a'), () => agent('review-b')]));
            for (const r of reviews) if (!r.ok) throw new Error(r.error);
            const combined = await phase('Synthesize', () => agent(reviews.map(r => r.output).join('|')));
            if (!combined.ok) throw new Error(combined.error); return combined.output;`,
          args: undefined, cwd: root, signal: controller.signal, onPhase: phase => phases.push(phase),
          onAgent: (prompt, _options, signal) => controller.schedule(inner => runChildTask({ ...task, prompt, signal: inner }), signal),
        });
        assert.deepEqual(phases, ['Review', 'Synthesize']);
        assert.match(String(result), /reply:review-a\|reply:review-b/);
      } finally { await controller.settle(true); }
    });
    await t.test('parent RPC startup, new-session, reload and resume keep child ownership', async () => {
      const parent = new RpcClient({ cliPath: fileURLToPath(new URL('../../../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url)), cwd: root,
        env: { PI_CODING_AGENT_DIR: agentDir, HOME: root, XDG_STATE_HOME: join(root, 'state'), PI_OFFLINE: '1' },
        provider: 'fixture', model: 'fixture', args: ['--no-extensions', '--no-skills', '--no-context-files', '--no-mcp', '-e', fixture, '-e', fileURLToPath(new URL('../index.ts', import.meta.url))] });
      try {
        await parent.start();
        const firstParent = await parent.getState();
        const owned = await command(['spawn', '--name', 'owned', '--prompt', 'first'], { ...cliEnv, PI_SESSION_ID: firstParent.sessionId });
        assert.equal(owned.code, 0, owned.stderr);
        const child = listRuns(firstParent.sessionId)[0]!;
        await until(() => readMetadata(child.runDir)?.completedAt);
        const pid = readMetadata(child.runDir)?.pid;
        await parent.prompt('/fixture-reload');
        await delay(1200);
        assert.equal((await parent.getState()).sessionId, firstParent.sessionId);
        assert.equal(readMetadata(child.runDir)?.pid, pid);
        await parent.newSession();
        assert.equal(readMetadata(child.runDir)?.suspended, true);
        assert.ok(firstParent.sessionFile);
        await parent.switchSession(firstParent.sessionFile);
        await until(() => readMetadata(child.runDir)?.state === 'idle' ? true : undefined);
        assert.notEqual(readMetadata(child.runDir)?.pid, pid);
        await delay(1200);
        assert.equal((await parent.getState()).sessionId, firstParent.sessionId);
        assert.ok(!parent.getStderr().includes('stale'), parent.getStderr());
        const entries = (await parent.getEntries()).entries;
        const notifications = entries.filter(entry => entry.type === 'custom_message' && entry.customType === 'subagent-result');
        assert.equal(notifications.length, 1, 'completion must not be delivered twice across reload/resume');
        enqueue(child.runDir, { message: 'after-resume', delivery: 'auto' });
        await until(() => readFileSync(child.sessionFile, 'utf8').includes('reply:after-resume') ? true : undefined);
        await delay(1200);
        const after = (await parent.getEntries()).entries.filter(entry => entry.type === 'custom_message' && entry.customType === 'subagent-result');
        assert.equal(after.length, 2, 'the new parent runtime must continue to receive results');
      } finally { await parent.stop(); }
    });
  } finally {
    await stopRun(readMetadata(runDir) ?? run);
    for (const child of listRuns()) await stopRun(child);
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(fixture, { force: true }); rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rejects nested children without spawning", async () => {
  const cli = fileURLToPath(new URL("../subagent.ts", import.meta.url));
  const child = spawn(process.execPath, [cli, "spawn", "--prompt", "test"], { env: { ...process.env, PI_SUBAGENT_RUN_DIR: "/fixture" } });
  let stderr = ""; child.stderr.on("data", (chunk) => stderr += chunk);
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 1); assert.match(stderr, /Nested subagents are disabled/);
});
