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
  assert.ok(files.includes('gpt6-sol-aliases.ts'));
  assert.ok(!files.includes('gpt56-pro-alias.ts'));
  assert.ok(!files.includes('gpt56-sol-aliases.ts'));
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
  const handler = h.handlers.get('context_with_system');
  assert.equal(h.handlers.has('before_provider_request'), false);
  const docs = 'Pi documentation (read only when the user asks about pi itself: local paths';
  const messages = [
    { role: 'system', content: 'Keep this.', sections: { docs: `<docs>\n${docs}\n</docs>`, rules: 'Keep rules.' }, toolsAdded: [{ name: 'read' }], timestamp: 0 },
    { role: 'user', content: docs, timestamp: 1 },
    { role: 'system', content: [{ type: 'text', text: `Keep this.\n\n<docs>\n${docs}\n</docs>\n\nKeep this too.`, textSignature: 'opaque' }], sections: { docs, old: null }, toolsRemoved: [{ name: 'write' }], timestamp: 2 },
  ];
  const before = structuredClone(messages);
  const result = await handler({ messages }, { model: { provider: 'anthropic' } });
  assert.equal(result.messages[0].role, 'system');
  assert.deepEqual(result.messages[0].sections, { docs: null, rules: 'Keep rules.' });
  assert.equal(result.messages[0].toolsAdded, messages[0].toolsAdded);
  assert.equal(result.messages[1], messages[1]);
  assert.deepEqual(result.messages[2].content, [{ type: 'text', text: 'Keep this.\n\nKeep this too.', textSignature: 'opaque' }]);
  assert.equal(result.messages[2].toolsRemoved, messages[2].toolsRemoved);
  assert.deepEqual(result.messages[2].sections, { docs: null, old: null });
  assert.equal(await handler({ messages }, { model: { provider: 'openai' } }), undefined);
  assert.equal(await handler(result, { model: { provider: 'anthropic' } }), undefined);
  assert.deepEqual(messages, before, 'saved history must remain unchanged');
  const legacy = { role: 'system', content: `Keep this.\n\n${docs}\n\nKeep this too.`, timestamp: 0 };
  assert.equal(handler({ messages: [legacy] }, { model: { provider: 'anthropic' } }).messages[0].content, 'Keep this.\n\nKeep this too.');
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
