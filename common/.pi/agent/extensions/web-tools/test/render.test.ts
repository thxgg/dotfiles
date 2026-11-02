import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KeybindingHints } from '@earendil-works/pi-coding-agent';
import { createWebFetchTool } from '../webfetch.ts';
import { createWebSearchTool } from '../websearch.ts';

const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
for (const tool of [createWebFetchTool(), createWebSearchTool()]) {
  test(`${tool.name} renders the host key hint and omits it when expanded`, () => {
    const context: Pick<KeybindingHints, 'keyHint'> = {
      keyHint(action, description) {
        assert.equal(action, 'app.tools.expand');
        return `ctrl+shift+e ${description}`;
      },
    };
    const result = { content: [{ type: 'text', text: 'Fixture output' }] };
    const compact = tool.renderResult(result, { expanded: false, isPartial: false }, theme, context).render(120).join('\n');
    assert.match(compact, /ctrl\+shift\+e for details/);
    const expanded = tool.renderResult(result, { expanded: true, isPartial: false }, theme, context).render(120).join('\n');
    assert.doesNotMatch(expanded, /for details/);
    assert.match(expanded, /Fixture output/);
  });
}
