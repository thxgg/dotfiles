import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

test('OpenAI extension loads through a Stow leaf symlink without a separately deployed library', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-openai-stow-test-'));
  try {
    const extensions = join(dir, 'extensions');
    mkdirSync(extensions);
    const link = join(extensions, 'gpt6-sol-aliases.ts');
    symlinkSync(fileURLToPath(new URL('../agent/extensions/gpt6-sol-aliases.ts', import.meta.url)), link);
    const probe = join(dir, 'probe.js');
    writeFileSync(probe, 'export default function(pi) { console.log("STOW_IMPORT_OK"); pi.registerCommand("probe", {description:"Offline load probe", handler:async()=>{}}); }');
    const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, '-ne', '-e', link, '-e', probe,
      '-ns', '-np', '-nc', '--no-session', '--no-approve', '--offline', '--no-tools', '-p', '/probe'], {
      cwd: dir, env: {...process.env, PI_CODING_AGENT_DIR:dir, PI_OFFLINE:'1'}, encoding:'utf8', timeout:20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr + result.stdout, /STOW_IMPORT_OK/);
    assert.doesNotMatch(result.stderr + result.stdout, /Failed to load extension/);
  } finally {
    rmSync(dir, {recursive:true,force:true});
  }
});

test('verbosity renderer loads through the existing Stow leaf links without new deployment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-verbosity-stow-test-'));
  try {
    const extensions = join(dir, 'extensions');
    const verbosity = join(extensions, 'verbosity');
    mkdirSync(verbosity, { recursive: true });
    for (const name of ['index.ts', 'adapter.ts', 'config.ts', 'model.ts', 'rebuild.ts', 'render.ts']) {
      symlinkSync(fileURLToPath(new URL('../agent/extensions/verbosity-level/' + name, import.meta.url)), join(verbosity, name));
    }
    const probe = join(dir, 'probe.js');
    writeFileSync(probe, 'export default function(pi) { pi.registerCommand("probe", {description:"Offline load probe", handler:async()=>{console.log("VERBOSITY_STOW_OK")}}); }');
    const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, '-ne', '-e', join(verbosity, 'index.ts'), '-e', probe,
      '-ns', '-np', '-nc', '--no-session', '--no-approve', '--offline', '--no-tools', '-p', '/probe'], {
      cwd: dir, env: {...process.env, PI_CODING_AGENT_DIR:dir, PI_OFFLINE:'1'}, encoding:'utf8', timeout:20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr + result.stdout, /VERBOSITY_STOW_OK/);
    assert.doesNotMatch(result.stderr + result.stdout, /Failed to load extension|Extension error/);
  } finally {
    rmSync(dir, {recursive:true,force:true});
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
