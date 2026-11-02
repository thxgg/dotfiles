import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadPromptTemplates, expandPromptTemplate } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/prompt-templates.js';

const configure = fileURLToPath(new URL('../../../scripts/configure-pi-updates.mjs', import.meta.url));
test('manual Pi review template discovers and expands versions without authorizing mutations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-review-template-'));
  try {
    const { templates, diagnostics } = loadPromptTemplates({ cwd: dir, agentDir: dir,
      promptPaths: [fileURLToPath(new URL('../agent/prompts/pi-review.md', import.meta.url))], includeDefaults: false });
    assert.deepEqual(diagnostics, []);
    assert.equal(templates.length, 1);
    assert.equal(templates[0].name, 'pi-review');
    assert.equal(templates[0].argumentHint, '[version or release range]');
    assert.match(expandPromptTemplate('/pi-review', templates), /Review Pi latest stable release/);
    const explicit = expandPromptTemplate('/pi-review 1.4.0 through 1.5.0', templates);
    assert.match(explicit, /Review Pi 1\.4\.0 through 1\.5\.0/);
    assert.match(explicit, /report-only request/);
    assert.match(explicit, /Do not start subagents/);
    assert.equal(expandPromptTemplate('ordinary user message', templates), 'ordinary user message');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('update preferences preserve unrelated settings and are repeatable without running an updater', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-update-settings-'));
  const path = join(dir, 'settings.json');
  const run = () => spawnSync(process.execPath, [configure, dir], { env: { PATH: '' }, encoding: 'utf8' });
  try {
    const original = { defaultModel: 'existing-model', packages: ['npm:example'], arbitrary: { keep: true } };
    writeFileSync(path, JSON.stringify(original), { mode: 0o600 });
    assert.equal(run().status, 0);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { ...original,
      selfUpdateCommand: ['vp', 'install', '--global', '{installSpec}'], collapseChangelog: false });
    const first = readFileSync(path, 'utf8');
    assert.equal(run().status, 0);
    assert.equal(readFileSync(path, 'utf8'), first);
    rmSync(path);
    assert.equal(run().status, 0, 'can initialize missing settings');
    for (const invalid of ['{broken', '[]', 'null']) {
      writeFileSync(path, invalid);
      assert.equal(run().status, 1);
      assert.equal(readFileSync(path, 'utf8'), invalid);
    }
    rmSync(path);
    const target = join(dir, 'tracked.json');
    writeFileSync(target, '{}');
    symlinkSync(target, path);
    assert.equal(run().status, 1);
    assert.equal(readFileSync(target, 'utf8'), '{}');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
