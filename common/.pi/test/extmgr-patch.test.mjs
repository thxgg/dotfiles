import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { patchPackage, patchSource } from '../../../scripts/patch-pi-extmgr.mjs';

const fixture = new URL('./fixtures/pi-extmgr-0.4.2/', import.meta.url);
const read = path => readFileSync(new URL(path, fixture), 'utf8');

test('patch is repeatable and rejects modified, partial, or unsupported sources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'extmgr-patch-'));
  try {
    cpSync(fixture, root, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'pi-extmgr', version: '0.4.2' }));
    const index = readFileSync(join(root, 'src/index.ts'), 'utf8');
    writeFileSync(join(root, 'src/commands/registry.ts'), 'modified source');
    await assert.rejects(patchPackage(root), /unsupported source/);
    assert.equal(readFileSync(join(root, 'src/index.ts'), 'utf8'), index, 'preflight all files before mutation');
    writeFileSync(join(root, 'src/commands/registry.ts'), read('src/commands/registry.ts'));
    await patchPackage(root);
    const first = readFileSync(join(root, 'src/commands/registry.ts'), 'utf8');
    await patchPackage(root);
    assert.equal(readFileSync(join(root, 'src/commands/registry.ts'), 'utf8'), first);
    assert.throws(() => patchSource('src/commands/registry.ts', first + '\n'), /unsupported source/);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'pi-extmgr', version: '0.4.3' }));
    await assert.rejects(patchPackage(root), /requires version 0.4.2/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('registry preserves synchronous command metadata but defers executable imports', () => {
  const patched = patchSource('src/commands/registry.ts', read('src/commands/registry.ts'));
  const js = ts.transpileModule(patched, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
  const parsed = ts.createSourceFile('registry.js', js, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
  const eager = parsed.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
  assert.deepEqual(eager.sort(), ['@earendil-works/pi-coding-agent', '../utils/notify.js', './completion.js'].sort());
  assert.match(js, /await import\("\.\.\/ui\/unified.js"\)/);
  assert.match(js, /const owners = await getRuntimeOwners/);
  assert.match(js, /const conflicts = await findRuntimeConflicts/);
  assert.match(js, /export function getExtensionsAutocompleteItems/);
  assert.match(js, /export function resolveCommand/);
  const index = patchSource('src/index.ts', read('src/index.ts'));
  assert.doesNotMatch(index, /^import .*packages\/install/m);
  assert.match(index, /await import\("\.\/packages\/install.js"\)/);
  for (const hook of ['session_start', 'session_shutdown']) assert.ok(index.includes(`pi.on("${hook}"`));
});
