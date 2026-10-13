import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'pi-child-bridge-test-'));
process.env.PI_CODING_AGENT_DIR = root;
process.env.PI_OFFLINE = '1';
delete process.env.HERDR_ENV;
delete process.env.HERDR_SOCKET_PATH;
after(() => rmSync(root, { recursive: true, force: true }));

const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
const { fauxProvider, fauxAssistantMessage } = await import('@earendil-works/pi-ai/providers/faux');
const { default: childBridge } = await import('../agent/extensions/subagents/child-bridge.ts');
const { JobStore } = await import('../agent/extensions/subagents/job-store.ts');

async function fixture(t, { maxTurns, outputSchema } = {}) {
  const dir = mkdtempSync(join(root, 'case-'));
  const store = new JobStore(join(dir, 'jobs'));
  const id = 'agent-aabbccdd';
  const paths = store.paths(id);
  const agent = {
    name: 'test-child', description: 'Offline child bridge fixture', permissions: {},
    background: true, hidden: false, systemPrompt: '', source: 'builtin',
    filePath: join(dir, 'agent.md'), maxTurns, outputSchema,
  };
  const startedAt = new Date().toISOString();
  store.initialize({ version: 2, jobId: id, stateDir: paths.dir, promptPath: paths.prompt, createdAt: startedAt, agent }, {
    id, agent: agent.name, source: agent.source, task: 'Inspect fixture', cwd: dir,
    status: 'running', background: true, backend: 'herdr', startedAt,
    owner: { sessionId: 'parent-fixture' },
  }, 'Inspect fixture');
  const previousSpec = process.env.PI_SUBAGENT_JOB_SPEC;
  process.env.PI_SUBAGENT_JOB_SPEC = paths.spec;
  t.after(() => {
    if (previousSpec === undefined) delete process.env.PI_SUBAGENT_JOB_SPEC;
    else process.env.PI_SUBAGENT_JOB_SPEC = previousSpec;
  });
  const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off', retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [childBridge],
  });
  await resourceLoader.reload();
  const faux = fauxProvider();
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: join(dir, 'models.json') });
  modelRuntime.registerNativeProvider(faux.provider);
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, resourceLoader, settingsManager, modelRuntime,
    model: faux.getModel(), sessionManager: SessionManager.inMemory(dir),
  });
  const errors = [];
  await session.bindExtensions({ mode: 'json', onError: error => errors.push(error) });
  t.after(() => {
    session.dispose();
    assert.deepEqual(errors, []);
    assert.equal(faux.state.callCount, 0);
  });
  return {
    emit: event => session.extensionRunner.emit(event),
    snapshot: () => store.read(id),
  };
}

for (const scenario of [
  { name: 'native abort before any assistant result', aborted: true, expected: 'cancelled' },
  { name: 'native abort after a successful assistant result', aborted: true, stopReason: 'stop', expected: 'cancelled' },
  { name: 'native abort with missing structured output', aborted: true, outputSchema: { type: 'object' }, expected: 'cancelled' },
  { name: 'assistant abort fallback', aborted: false, stopReason: 'aborted', expected: 'cancelled' },
  { name: 'turn limit fallback', aborted: false, maxTurns: 1, expected: 'cancelled' },
  { name: 'normal completion', aborted: false, stopReason: 'stop', expected: 'completed' },
  { name: 'provider failure', aborted: false, stopReason: 'error', expected: 'failed' },
]) {
  test(`child bridge persists ${scenario.name}`, async t => {
    const h = await fixture(t, scenario);
    if (scenario.stopReason) {
      await h.emit({ type: 'message_end', message: { ...fauxAssistantMessage('Fixture result'), stopReason: scenario.stopReason } });
    }
    if (scenario.maxTurns) await h.emit({ type: 'turn_end', turnIndex: 0 });
    await h.emit({ type: 'agent_settled', aborted: scenario.aborted });
    const snapshot = h.snapshot();
    assert.equal(snapshot.status, scenario.expected);
    assert.ok(snapshot.endedAt);
    assert.equal(snapshot.notifications.length, 1);
    assert.equal(snapshot.notifications[0].kind, 'completion');
    if (scenario.maxTurns) assert.match(snapshot.error, /maxTurns=1/);
    await h.emit({ type: 'agent_settled', aborted: scenario.aborted });
    assert.deepEqual(h.snapshot(), snapshot, 'repeated settlement must not change the result');
  });
}
