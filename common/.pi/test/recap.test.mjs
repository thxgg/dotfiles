import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'pi-recap-test-'));
process.env.PI_CODING_AGENT_DIR = root;
process.env.PI_OFFLINE = '1';
delete process.env.HERDR_ENV;
delete process.env.HERDR_SOCKET_PATH;
after(() => rmSync(root, { recursive: true, force: true }));

const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
const { fauxProvider, fauxAssistantMessage } = await import('@earendil-works/pi-ai/providers/faux');
const { default: recap } = await import('../agent/extensions/recap/index.ts');

async function fixture(t, { auto = true, enabled = true } = {}) {
  const settingsPath = join(root, 'settings.json');
  const statePath = join(root, '.cache/session-recap/state.json');
  const settings = JSON.stringify({ recap: { enabled, auto, model: 'current' } });
  const state = JSON.stringify({ enabled });
  mkdirSync(join(root, '.cache/session-recap'), { recursive: true });
  writeFileSync(settingsPath, settings);
  writeFileSync(statePath, state);
  const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off', retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root, agentDir: root, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [recap],
  });
  await resourceLoader.reload();
  const faux = fauxProvider();
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json') });
  modelRuntime.registerNativeProvider(faux.provider);
  const manager = SessionManager.inMemory(root);
  const userKey = manager.appendMessage({ role: 'user', content: 'Fix recap', timestamp: 0 });
  manager.appendCustomEntry('session-recap', { action: 'set', text: 'Old recap', key: userKey });
  const { session } = await createAgentSession({
    cwd: root, agentDir: root, resourceLoader, settingsManager, modelRuntime,
    model: faux.getModel(), sessionManager: manager,
  });
  const ui = { widget: undefined, status: undefined, listeners: new Set(), notifications: [] };
  const errors = [];
  await session.bindExtensions({
    mode: 'tui',
    uiContext: {
      setWidget: (_key, widget) => { ui.widget = widget; },
      setStatus: (_key, status) => { ui.status = status; },
      notify: (text, level) => { ui.notifications.push({ text, level }); },
      onTerminalInput: listener => {
        ui.listeners.add(listener);
        return () => ui.listeners.delete(listener);
      },
    },
    onError: error => errors.push(error),
  });
  t.after(async () => {
    await session.extensionRunner.emit({ type: 'session_shutdown' });
    session.dispose();
    assert.deepEqual(errors, []);
    assert.equal(readFileSync(settingsPath, 'utf8'), settings);
    assert.equal(readFileSync(statePath, 'utf8'), state);
  });
  const respond = () => faux.appendResponses([fauxAssistantMessage('Fix recap; run tests')]);
  const blur = () => { for (const listener of ui.listeners) listener('\x1b[O'); };
  const newTurn = async () => {
    const message = { role: 'user', content: 'Continue', timestamp: 1 };
    manager.appendMessage(message);
    await session.extensionRunner.emit({ type: 'message_start', message });
    await session.extensionRunner.emit({ type: 'agent_settled' });
  };
  return { session, manager, faux, ui, respond, blur, newTurn };
}

test('recap stays off until /recap, toggles locally, and ignores cached activation', async t => {
  const h = await fixture(t);
  assert.equal(h.ui.widget, undefined);
  assert.equal(h.ui.listeners.size, 0);
  const count = h.manager.getBranch().length;
  await h.session.extensionRunner.emit({ type: 'session_tree', newLeafId: null, oldLeafId: null });
  await h.session.extensionRunner.emit({ type: 'agent_settled' });
  assert.equal(h.manager.getBranch().length, count);
  assert.equal(h.faux.state.callCount, 0);
  assert.equal(h.ui.widget, undefined);

  h.respond();
  await h.session.prompt('/recap');
  assert.equal(h.faux.state.callCount, 1);
  assert.equal(typeof h.ui.widget, 'function');
  assert.equal(h.ui.listeners.size, 1);
  await h.session.extensionRunner.emit({ type: 'session_compact' });
  await h.session.extensionRunner.emit({ type: 'session_tree', newLeafId: null, oldLeafId: null });
  assert.equal(typeof h.ui.widget, 'function');

  await h.session.prompt('/recap');
  assert.equal(h.ui.widget, undefined);
  assert.equal(h.ui.status, undefined);
  assert.equal(h.ui.listeners.size, 0);
  await h.newTurn();
  assert.equal(h.faux.state.callCount, 1);
  assert.equal(h.ui.widget, undefined);
  h.respond();
  await h.session.prompt('/recap');
  assert.equal(h.faux.state.callCount, 2);
  assert.equal(h.ui.listeners.size, 1);
});

test('recap resets on every session start and honors auto=false after explicit activation', async t => {
  const h = await fixture(t, { auto: false, enabled: false });
  for (const reason of ['startup', 'new', 'resume', 'fork', 'reload']) {
    h.respond();
    await h.session.prompt('/recap');
    assert.equal(typeof h.ui.widget, 'function');
    assert.equal(h.ui.listeners.size, 0);
    await h.session.extensionRunner.emit({ type: 'session_start', reason });
    assert.equal(h.ui.widget, undefined);
    assert.equal(h.ui.listeners.size, 0);
  }
  assert.equal(h.faux.state.callCount, 5);
});

test('recap refreshes automatically only while enabled and cancels a pending timer', async t => {
  const h = await fixture(t);
  h.respond();
  await h.session.prompt('/recap');
  await h.newTurn();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  h.blur();
  h.respond();
  t.mock.timers.tick(30_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.faux.state.callCount, 2);
  assert.equal(typeof h.ui.widget, 'function');
  await h.newTurn();
  await h.session.prompt('/recap');
  t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.faux.state.callCount, 2);
  assert.equal(h.ui.widget, undefined);
  assert.equal(h.ui.listeners.size, 0);
});

test('turning recap off aborts an in-flight summary and suppresses its late result', async t => {
  const h = await fixture(t);
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  h.faux.appendResponses([(_context, options) => {
    started.resolve(options.signal);
    return response.promise;
  }]);
  const running = h.session.prompt('/recap');
  const signal = await started.promise;
  assert.equal(signal.aborted, false);
  await h.session.prompt('/recap');
  assert.equal(signal.aborted, true);
  response.resolve(fauxAssistantMessage('Late result'));
  await running;
  assert.equal(h.ui.widget, undefined);
  assert.equal(h.ui.status, undefined);
  assert.equal(h.ui.listeners.size, 0);
  assert.equal(h.manager.getBranch().filter(entry => entry.type === 'custom').length, 1);
});
