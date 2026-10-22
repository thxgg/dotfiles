import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('RPC sanitizes a T3-style full prompt override before provider transmission', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-sanitizer-rpc-'));
  const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
  const sanitizer = fileURLToPath(new URL('../agent/extensions/anthropic-prompt-sanitizer.ts', import.meta.url));
  const override = join(dir, 'override.js');
  const capture = join(dir, 'capture.js');
  writeFileSync(override, `export default function(pi) {
    pi.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt + '\\n\\nT3 Code orchestration' }));
  }`);
  // Explicit extension order places this after the sanitizer. Exiting here is
  // intentional: throwing from an extension is swallowed and would send the request.
  writeFileSync(capture, `export default function(pi) {
    pi.on('before_provider_request', (event, ctx) => {
      const system = JSON.stringify(event.payload.system);
      console.log('SANITIZER_RESULT:' + JSON.stringify({
        mode: ctx.mode,
        hasDocs: system.includes('Pi documentation (read only when the user asks about pi itself'),
        hasT3: system.includes('T3 Code orchestration'),
        hasUser: JSON.stringify(event.payload.messages).includes('USER_MARKER'),
      }));
      process.exit(0);
    });
  }`);
  try {
    for (const enabled of [false, true]) {
      const args = [cli, '--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills',
        '--no-prompt-templates', '--no-context-files', '--offline', '--provider', 'anthropic',
        '--model', 'claude-opus-4-6', '--api-key', 'synthetic-not-a-real-key', '-e', override,
        ...(enabled ? ['-e', sanitizer] : []), '-e', capture];
      const result = spawnSync(process.execPath, args, {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir, PI_CODING_AGENT_DIR: dir, PI_OFFLINE: '1' },
        input: JSON.stringify({ type: 'prompt', message: 'USER_MARKER' }) + '\n',
        encoding: 'utf8', timeout: 20_000,
      });
      assert.equal(result.status, 0, result.stderr);
      const line = (result.stdout + '\n' + result.stderr).split('\n').find(value => value.startsWith('SANITIZER_RESULT:'));
      assert.ok(line, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(line.slice('SANITIZER_RESULT:'.length)), {
        mode: 'rpc', hasDocs: !enabled, hasT3: true, hasUser: true,
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
