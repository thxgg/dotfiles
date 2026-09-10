import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const agentDir = mkdtempSync(join(tmpdir(), 'pi-standalone-test-'));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.HERDR_ENV;
delete process.env.HERDR_SOCKET_PATH;
after(() => rmSync(agentDir, { recursive: true, force: true }));

function harness() {
  const handlers = new Map();
  const registrations = [];
  const register = (...args) => registrations.push(args);
  return {
    handlers,
    registrations,
    api: {
      on: (name, handler) => handlers.set(name, handler),
      registerCommand: register,
      registerShortcut: register,
      registerProvider: register,
      registerFlag: register,
      events: { on: register, emit: register },
    },
  };
}

test('every standalone extension imports and registers without starting a session', async () => {
  const root = new URL('../agent/extensions/', import.meta.url);
  const files = readdirSync(root).filter((name) => /\.(ts|js)$/.test(name));
  assert.ok(files.length >= 8);
  for (const file of [...files, 'pi-cloak/index.ts']) {
    const extension = await import(new URL(file, root));
    assert.equal(typeof extension.default, 'function', file);
    const h = harness();
    await extension.default(h.api);
    if (file === 'herdr-agent-state.ts') {
      assert.equal(h.handlers.size + h.registrations.length, 0, 'Herdr must stay inactive outside Herdr');
    } else {
      assert.ok(h.handlers.size + h.registrations.length > 0, file);
    }
  }
});

test('Anthropic sanitation preserves user content and other providers', async () => {
  const { default: extension } = await import('../agent/extensions/anthropic-prompt-sanitizer.ts');
  const h = harness();
  extension(h.api);
  const handler = h.handlers.get('before_provider_request');
  const messages = [{ role: 'user', content: 'Preserve this request' }];
  const payload = {
    system: [{ type: 'text', text: 'Keep this.\n\nPi documentation (read only when the user asks about pi itself: local paths\n\nKeep this too.' }],
    messages,
  };
  const result = await handler({ payload }, { model: { provider: 'anthropic' } });
  assert.equal(result.system[0].text, 'Keep this.\n\nKeep this too.');
  assert.equal(result.messages, messages);
  assert.equal(await handler({ payload }, { model: { provider: 'openai' } }), undefined);
  assert.match(payload.system[0].text, /Pi documentation/);
});

test('cloak masks only matching paths with isolated synthetic configuration', async () => {
  const { cloakText, loadState } = await import('../agent/extensions/pi-cloak/index.ts');
  const dir = mkdtempSync(join(tmpdir(), 'pi-cloak-test-'));
  try {
    const config = join(dir, 'cloak.json');
    writeFileSync(config, JSON.stringify({ patterns: [{ filePattern: '**/.env', cloakPattern: 'value-to-mask' }] }));
    const state = loadState(config);
    assert.equal(state.error, undefined);
    assert.equal(cloakText('KEY=value-to-mask', '.env', dir, state), 'KEY=v************');
    assert.equal(cloakText('KEY=value-to-mask', 'README.md', dir, state), 'KEY=value-to-mask');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
