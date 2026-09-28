import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getProjectPaths } from '../agent/extensions/pi-ephemeral/src/util.ts';
import { readProjectMcp, writeProjectMcp } from '../agent/extensions/pi-ephemeral/src/mcp.ts';

test('ephemeral writes adapter config and preserves built-in and shared MCP files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ephemeral-mcp-'));
  try {
    const paths = getProjectPaths(cwd);
    assert.equal(paths.projectMcpPath, join(cwd, '.pi', 'mcp-adapter.json'));
    await writeProjectMcp(paths.projectMcpPath, { mcpServers: {} });
    const builtin = join(cwd, '.pi', 'mcp.json');
    const shared = join(cwd, '.mcp.json');
    for (const path of [builtin, shared]) await writeFile(path, 'leave unchanged\n');
    await writeProjectMcp(paths.projectMcpPath, {
      settings: { directTools: false },
      mcpServers: { selected: { command: 'example' } },
    });
    assert.deepEqual(await readProjectMcp(paths.projectMcpPath), {
      settings: { directTools: false, loadSharedProjectConfig: false },
      mcpServers: { selected: { command: 'example' } },
    });
    for (const path of [builtin, shared]) assert.equal(await readFile(path, 'utf8'), 'leave unchanged\n');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
