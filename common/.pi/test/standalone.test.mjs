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
// T3 sets this for Pi sessions it hosts. Clear it so results do not depend on the caller.
delete process.env.T3_MCP_URL;
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
    } else if (file === 't3-visual-guide.ts') {
      assert.equal(h.handlers.size + h.registrations.length, 0, 'The T3 guide must stay inactive outside T3');
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
