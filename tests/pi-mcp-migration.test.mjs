import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { migrateProjects, toNativeMcpServer } from '../scripts/migrate-pi-mcp.mjs';

test('converts supported settings and rejects adapter-only behavior', () => {
  assert.deepEqual(toNativeMcpServer('docs', { command: 'echo', idleTimeout: 10 }), { command: 'echo' });
  assert.deepEqual(toNativeMcpServer('slack', {
    url: 'https://example.com/mcp', auth: 'oauth',
    oauth: { clientId: 'public', redirectUri: 'http://localhost:3118/callback' },
  }), { url: 'https://example.com/mcp', oauth: { clientId: 'public', callbackUrl: 'http://localhost:3118/callback' } });
  assert.throws(() => toNativeMcpServer('bad', { command: 'echo', lifecycle: 'lazy' }), /unsupported fields: lifecycle/);
});

test('preserves native servers, migrates managed MCPs, and archives Ephemeral without removing skills', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-mcp-migrate-'));
  try {
    const pi = join(cwd, '.pi');
    await mkdir(join(pi, 'skills', 'custom'), { recursive: true });
    await writeFile(join(pi, 'skills', 'custom', 'SKILL.md'), '# custom\n');
    const old = { settings: { loadSharedProjectConfig: false }, mcpServers: {
      docs: { url: 'https://example.com/mcp', idleTimeout: 10 },
    } };
    await writeFile(join(pi, 'mcp-adapter.json'), JSON.stringify(old));
    await writeFile(join(pi, 'mcp.json'), JSON.stringify({ mcpServers: { existing: { command: 'echo' } } }));
    await writeFile(join(pi, 'ephemeral.json'), JSON.stringify({ version: 1, items: {
      'mcp:docs': { type: 'mcp', serverName: 'docs', targetPaths: [join(pi, 'mcp-adapter.json')] },
      'skill:custom': { type: 'skill', targetPaths: [join(pi, 'skills', 'custom')] },
    } }));
    await migrateProjects([cwd]);
    const native = JSON.parse(await readFile(join(pi, 'mcp.json'), 'utf8'));
    assert.deepEqual(native.mcpServers, { existing: { command: 'echo' }, docs: { url: 'https://example.com/mcp' } });
    assert.deepEqual(JSON.parse(await readFile(join(pi, 'mcp-adapter.json.migrated'), 'utf8')), old);
    const manifest = JSON.parse(await readFile(join(pi, 'ephemeral.json.migrated'), 'utf8'));
    assert.deepEqual(manifest.items['mcp:docs'].targetPaths, [join(pi, 'mcp.json')]);
    assert.equal(await readFile(join(pi, 'skills', 'custom', 'SKILL.md'), 'utf8'), '# custom\n');
    assert.equal(await migrateProjects([cwd]), 0);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('refuses name conflicts and preserves source configs', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-mcp-conflict-'));
  try {
    const pi = join(cwd, '.pi');
    await mkdir(pi);
    const old = JSON.stringify({ mcpServers: { docs: { command: 'false' } } });
    const native = JSON.stringify({ mcpServers: { docs: { command: 'true' } } });
    await writeFile(join(pi, 'mcp-adapter.json'), old);
    await writeFile(join(pi, 'mcp.json'), native);
    await assert.rejects(migrateProjects([cwd]), /already exists/);
    assert.equal(await readFile(join(pi, 'mcp-adapter.json'), 'utf8'), old);
    assert.equal(await readFile(join(pi, 'mcp.json'), 'utf8'), native);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('copies shared project MCP config without removing it', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-mcp-shared-'));
  try {
    const shared = JSON.stringify({ mcpServers: { tool: { command: 'echo' } } });
    await writeFile(join(cwd, '.mcp.json'), shared);
    await migrateProjects([cwd]);
    assert.equal(await readFile(join(cwd, '.mcp.json'), 'utf8'), shared);
    assert.deepEqual(JSON.parse(await readFile(join(cwd, '.pi', 'mcp.json'), 'utf8')).mcpServers, { tool: { command: 'echo' } });
    assert.equal(await migrateProjects([cwd]), 0);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
