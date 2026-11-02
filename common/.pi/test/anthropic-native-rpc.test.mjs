import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Offline payload check. The capture exits before any provider request is sent.
test('native Anthropic RPC preserves documentation and a T3-style full prompt override', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-anthropic-rpc-'));
  const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
  const override = join(dir, 'override.js');
  const capture = join(dir, 'capture.js');
  writeFileSync(override, `export default function(pi) {
    pi.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt + '\\n\\nT3 Code orchestration' }));
  }`);
  writeFileSync(capture, `export default function(pi) {
    pi.on('before_provider_request', (event, ctx) => {
      const system = JSON.stringify(event.payload.system);
      console.log('NATIVE_RESULT:' + JSON.stringify({
        mode: ctx.mode,
        hasDocs: system.includes('Pi documentation'),
        hasT3: system.includes('T3 Code orchestration'),
        hasUser: JSON.stringify(event.payload.messages).includes('USER_MARKER'),
        hasRead: event.payload.tools.some(tool => tool.name === 'read'),
      }));
      process.exit(0);
    });
  }`);
  try {
    const result = spawnSync(process.execPath, [cli, '--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills',
      '--no-prompt-templates', '--no-context-files', '--offline', '--provider', 'anthropic',
      '--model', 'claude-opus-5-5', '--api-key', 'synthetic-not-a-real-key', '-e', override, '-e', capture], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, PI_CODING_AGENT_DIR: dir, PI_OFFLINE: '1' },
      input: JSON.stringify({ type: 'prompt', message: 'USER_MARKER' }) + '\n',
      encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const line = (result.stdout + '\n' + result.stderr).split('\n').find(value => value.startsWith('NATIVE_RESULT:'));
    assert.ok(line, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(line.slice('NATIVE_RESULT:'.length)), {
      mode: 'rpc', hasDocs: true, hasT3: true, hasUser: true, hasRead: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
