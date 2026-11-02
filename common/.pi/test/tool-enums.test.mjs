import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { createWebFetchTool } from '../agent/extensions/web-tools/webfetch.ts';
import { createWebSearchTool } from '../agent/extensions/web-tools/websearch.ts';
import { registerRepoCacheTool } from '../agent/extensions/subagents/repo-cache.ts';
import workflows from '../agent/extensions/workflows/index.ts';
import painter from '../agent/extensions/painter/index.ts';

function capture(register) {
  let tool;
  register({ registerTool: value => { tool = value; }, on() {}, registerCommand() {}, registerMessageRenderer() {} });
  assert.ok(tool);
  return tool;
}

test('Pi 1.5 validates every enum value, omitted defaults and invalid values without executing tools', () => {
  const previous = process.env.PI_SUBAGENT_RUN_DIR;
  delete process.env.PI_SUBAGENT_RUN_DIR;
  try {
    const cases = [
      [createWebFetchTool(), { url: 'https://example.com' }],
      [createWebSearchTool(), { query: 'fixture' }],
      [capture(registerRepoCacheTool), { url: 'https://github.com/example/repo' }],
      [capture(workflows), {}],
      [capture(painter), { prompt: 'fixture' }],
    ];
    let count = 0;
    for (const [tool, base] of cases) {
      const parse = args => validateToolArguments(tool, { type: 'toolCall', id: 'fixture', name: tool.name, arguments: args });
      assert.doesNotThrow(() => parse(base));
      for (const [name, schema] of Object.entries(tool.parameters.properties)) {
        if (!schema.enum) continue;
        count++;
        assert.equal(schema.type, 'string');
        assert.ok(!tool.parameters.required?.includes(name), `${tool.name}.${name} stays optional`);
        for (const value of schema.enum) {
          assert.equal(parse({ ...base, [name]: value })[name], value);
        }
        assert.throws(() => parse({ ...base, [name]: '__invalid_enum__' }));
      }
    }
    assert.equal(count, 7);
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_RUN_DIR;
    else process.env.PI_SUBAGENT_RUN_DIR = previous;
  }
});
