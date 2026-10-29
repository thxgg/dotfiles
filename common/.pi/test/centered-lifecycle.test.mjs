import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';

const root = mkdtempSync(join(tmpdir(), 'centered-lifecycle-'));
process.env.PI_CODING_AGENT_DIR = root;
process.env.PI_OFFLINE = '1';
process.env.PI_CENTERED_WIDTH = '110';
process.argv[1] = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
after(() => rmSync(root, { recursive: true, force: true }));
const { createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, initTheme } = await import('@earendil-works/pi-coding-agent');
const { Container, Text } = await import('@earendil-works/pi-tui');
const { fauxProvider } = await import('@earendil-works/pi-ai/providers/faux');
const { default: centered } = await import('../agent/extensions/pi-centered.ts');
initTheme('dark', false);

async function fixture() {
  let enabled = true;
  let fail = false;
  let cancel = false;
  let beforeLoad = async () => {};
  const container = new Container();
  container.addChild(new Text('Marker', 0, 0));
  const tui = { children: [container], requestRender() {} };
  const ui = { notify() {}, setWidget(_key, factory) { factory?.(tui); } };
  const faux = fauxProvider();
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json') });
  modelRuntime.registerNativeProvider(faux.provider);
  const create = async ({ sessionManager, sessionStartEvent }) => {
    const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off' });
    const resources = new DefaultResourceLoader({
      cwd: root, agentDir: root, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [async pi => {
        await beforeLoad();
        if (fail) throw new Error('Fixture extension failed');
        if (enabled) await centered(pi);
        pi.on('session_before_switch', () => ({ cancel }));
      }],
    });
    await resources.reload();
    const created = await createAgentSession({ cwd: root, agentDir: root, resourceLoader: resources,
      settingsManager, modelRuntime, model: faux.getModel(), sessionManager, sessionStartEvent });
    return { ...created, services: { agentDir: root, resourceLoader: resources }, diagnostics: [] };
  };
  const runtime = await createAgentSessionRuntime(create, { cwd: root, agentDir: root, sessionManager: SessionManager.inMemory(root) });
  const bind = session => session.bindExtensions({ mode: 'tui', uiContext: ui });
  runtime.setRebindSession(bind);
  await bind(runtime.session);
  return {
    runtime,
    setEnabled(value) { enabled = value; },
    setFail(value) { fail = value; },
    setCancel(value) { cancel = value; },
    beforeLoad(fn) { beforeLoad = fn; },
    left(width = 180) { return stripVTControlCharacters(container.render(width)[0]).indexOf('Marker'); },
  };
}

for (const operation of ['reload', 'new']) {
  test(`${operation}: center throughout async replacement, including resize`, async () => {
    const h = await fixture();
    try {
      assert.equal(h.left(), 35);
      h.beforeLoad(async () => {
        assert.equal(h.left(), 35);
        await delay(5);
        assert.equal(h.left(240), 65);
      });
      if (operation === 'reload') await h.runtime.session.reload();
      else await h.runtime.newSession();
      assert.equal(h.left(), 35);
    } finally { await h.runtime.dispose(); }
    assert.equal(h.left(), 0, 'quit restores native rendering');
  });

  for (const failure of ['removed', 'load-failed']) {
    test(`${operation}: ${failure} restores native layout after replacement`, async () => {
      const h = await fixture();
      try {
        h.beforeLoad(async () => { assert.equal(h.left(), 35); await delay(2); });
        h.setEnabled(false);
        if (failure === 'load-failed') h.setFail(true);
        if (operation === 'reload') await h.runtime.session.reload();
        else await h.runtime.newSession();
        assert.equal(h.left(), 0);
      } finally { await h.runtime.dispose(); }
    });
  }
}

test('cancelled new session leaves the existing centered layout active', async () => {
  const h = await fixture();
  try {
    h.setCancel(true);
    assert.deepEqual(await h.runtime.newSession(), { cancelled: true });
    assert.equal(h.left(), 35);
  } finally { await h.runtime.dispose(); }
});

test('failed new runtime clears layout even when no session_start is emitted', async () => {
  const h = await fixture();
  h.beforeLoad(async () => {});
  const original = h.runtime.createRuntime;
  h.runtime.createRuntime = async () => { assert.equal(h.left(), 35); throw new Error('runtime unavailable'); };
  try {
    await assert.rejects(h.runtime.newSession(), /runtime unavailable/);
    assert.equal(h.left(), 0);
  } finally { h.runtime.createRuntime = original; await h.runtime.dispose(); }
});
