import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
const extension = fileURLToPath(new URL('../agent/extensions/t3-visual-guide.ts', import.meta.url));
const guidePath = fileURLToPath(new URL('../agent/t3/visual-guide.md', import.meta.url));
const GUIDE_MARKER = 'Dig for the finding before you draw';

function writeCapture(dir) {
  const capture = join(dir, 'capture.js');
  // Exit before any network call: throwing from an extension is swallowed and would send the request.
  writeFileSync(capture, `export default function(pi) {
    pi.on('before_provider_request', (event, ctx) => {
      const system = JSON.stringify(event.payload.system);
      const marker = ${JSON.stringify(GUIDE_MARKER)};
      console.log('GUIDE_RESULT:' + JSON.stringify({
        mode: ctx.mode,
        guideCount: system.split(marker).length - 1,
        hasSectionTag: system.includes('t3_visual_guide'),
        hasT3: system.includes('T3 Code orchestration'),
        hasUser: JSON.stringify(event.payload.messages).includes('USER_MARKER'),
      }));
      process.exit(0);
    });
  }`);
  return capture;
}

function runPi(dir, { env = {}, before = [], after = [], extensionPath = extension } = {}) {
  const args = [cli, '--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills',
    '--no-prompt-templates', '--no-context-files', '--offline', '--provider', 'anthropic',
    '--model', 'claude-opus-4-6', '--api-key', 'synthetic-not-a-real-key',
    ...before.flatMap(path => ['-e', path]), '-e', extensionPath,
    ...after.flatMap(path => ['-e', path]), '-e', writeCapture(dir)];
  const result = spawnSync(process.execPath, args, {
    cwd: dir,
    env: { PATH: process.env.PATH, HOME: dir, PI_CODING_AGENT_DIR: dir, PI_OFFLINE: '1', ...env },
    input: JSON.stringify({ type: 'prompt', message: 'USER_MARKER' }) + '\n',
    encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout + '\n' + result.stderr;
  const line = output.split('\n').find(value => value.startsWith('GUIDE_RESULT:'));
  assert.ok(line, output);
  return { result: JSON.parse(line.slice('GUIDE_RESULT:'.length)), output };
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-t3-guide-rpc-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the deployed guide contains the expected rules', () => {
  const guide = readFileSync(guidePath, 'utf8');
  assert.match(guide, /^## T3 Code visuals/);
  assert.ok(guide.includes(GUIDE_MARKER));
  assert.ok(guide.includes('html_preview'));
  // The view kit is not loaded by T3, so the guide must not reference it.
  assert.ok(!guide.includes('window.v') && !guide.includes('.v-title'));
});

test('outside T3 the guide is never added', () => {
  withTempDir(dir => {
    const { result } = runPi(dir);
    assert.deepEqual(result, { mode: 'rpc', guideCount: 0, hasSectionTag: false, hasT3: false, hasUser: true });
  });
});

test('inside T3 the guide is added once as its own section next to T3 instructions', () => {
  withTempDir(dir => {
    // Mirrors T3's extension, which adds its own named section in the same hook.
    const t3 = join(dir, 't3.js');
    writeFileSync(t3, `export default function(pi) {
      pi.on('before_agent_start', event => { event.systemPromptOptions.sections.t3_code_orchestration = 'T3 Code orchestration'; });
    }`);
    for (const order of ['before', 'after']) {
      const { result } = runPi(dir, { env: { T3_MCP_URL: 'http://127.0.0.1:9/mcp' }, [order]: [t3] });
      assert.deepEqual(result, { mode: 'rpc', guideCount: 1, hasSectionTag: true, hasT3: true, hasUser: true }, order);
    }
  });
});

test('inside T3 the guide survives a full system prompt override', () => {
  withTempDir(dir => {
    const override = join(dir, 'override.js');
    writeFileSync(override, `export default function(pi) {
      pi.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt + '\\n\\nT3 Code orchestration' }));
    }`);
    const { result } = runPi(dir, { env: { T3_MCP_URL: 'http://127.0.0.1:9/mcp' }, before: [override] });
    assert.deepEqual(result, { mode: 'rpc', guideCount: 1, hasSectionTag: false, hasT3: true, hasUser: true });
  });
});

test('inside T3 a missing guide file sends the request without the guide', () => {
  withTempDir(dir => {
    const { result } = runPi(dir, {
      env: { T3_MCP_URL: 'http://127.0.0.1:9/mcp', T3_VISUAL_GUIDE_PATH: join(dir, 'missing.md') },
    });
    assert.deepEqual(result, { mode: 'rpc', guideCount: 0, hasSectionTag: false, hasT3: false, hasUser: true });
  });
});

test('inside T3 the guide loads through Stow leaf symlinks', () => {
  withTempDir(dir => {
    // Mirrors ~/.pi/agent after ./safe-stow.sh --only-pi.
    mkdirSync(join(dir, 'agent/extensions'), { recursive: true });
    mkdirSync(join(dir, 'agent/t3'), { recursive: true });
    const link = join(dir, 'agent/extensions/t3-visual-guide.ts');
    symlinkSync(extension, link);
    symlinkSync(guidePath, join(dir, 'agent/t3/visual-guide.md'));
    const { result, output } = runPi(dir, { env: { T3_MCP_URL: 'http://127.0.0.1:9/mcp' }, extensionPath: link });
    assert.doesNotMatch(output, /Failed to load extension|visual guide unavailable/);
    assert.deepEqual(result, { mode: 'rpc', guideCount: 1, hasSectionTag: true, hasT3: false, hasUser: true });
  });
});
