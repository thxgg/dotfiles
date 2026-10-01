import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import aliasChecks from '../../../tests/pi-model-aliases.test.js';
import aliases from '../agent/extensions/gpt6-sol-aliases.ts';

test('speed aliases use the OpenAI serializer, including direct compaction requests', async () => {
  let registered = false;
  await aliasChecks({ registerCommand: () => { registered = true; } });
  assert.equal(registered, true, 'the serializer checks must finish successfully');
});

test('OpenAI aliases preserve subscription auth and Painter’s legacy provider', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ultrafast-test-'));
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(dir, 'auth.json'),
      modelsStorePath: join(dir, 'models-cache.json'),
      modelsPath: fileURLToPath(new URL('../agent/models.json', import.meta.url)),
      refreshOnCreate: false,
    });
    assert.equal(runtime.getError(), undefined);
    const painterProvider = runtime.getProvider('openai-codex');
    await aliases({ registerProvider: (id, config) => runtime.registerProvider(id, config), on() {} });
    assert.equal(runtime.getProvider('openai').auth.oauth.isSubscription, true);
    assert.equal(runtime.getProvider('openai-codex'), painterProvider, 'leave Painter’s provider untouched');
    assert.equal(runtime.getModel('openai-codex', 'gpt-6-astra').api, 'openai-codex-responses');
    const alias = runtime.getModel('openai', 'gpt-6-astra-ultrafast');
    assert.ok(alias);
    assert.equal(runtime.getModel('openai-codex', alias.id), undefined);
    assert.equal(alias.api, 'openai-responses');
    assert.equal(alias.baseUrl, 'https://api.openai.com/v1');
    assert.match(alias.name, /Pro 500/);
    assert.equal(alias.samplingParams, undefined, 'the extension owns request rewriting');
    assert.equal(alias.cost.input, 60);
    assert.equal(alias.cost.output, 300);
    assert.equal(runtime.getModel('openai', 'gpt-6-sol-fast'), undefined);
    const sol = runtime.getModel('openai', 'gpt-6.1-sol-fast');
    const standard = runtime.getModel('openai', 'gpt-6.1-sol');
    assert.ok(sol);
    assert.ok(standard);
    assert.equal(sol.thinkingLevelMap.off, standard.thinkingLevelMap.off);
    assert.deepEqual(sol.cost, standard.cost);
    assert.deepEqual(runtime.getModel('openai', 'gpt-6-astra-fast').cost, runtime.getModel('openai', 'gpt-6-astra').cost);
    assert.equal(runtime.getModel('openai-codex', 'gpt-6-astra-fast'), undefined);
    for (const [id, upstream, tier] of [
      ['gpt-6-astra-fast', 'gpt-6-astra', 'priority'],
      ['gpt-6.1-sol-fast', 'gpt-6.1-sol', 'priority'],
      ['gpt-6-astra-ultrafast', 'gpt-6-astra', 'ultrafast'],
      ['gpt-6-astra', 'gpt-6-astra', undefined],
    ]) {
      const model = runtime.getModel('openai', id);
      assert.ok(model);
      let sent;
      // Exercise the registered runtime without session hooks, as compaction does.
      const result = await runtime.streamSimple(model, {
        messages: [{ role: 'user', content: 'Say OK', timestamp: 0 }],
      }, {
        apiKey: 'pi-openai-test-oauth', env: {}, reasoning: 'low', maxRetries: 0,
        fetch: async (url, init) => {
          assert.equal(String(url), 'https://api.openai.com/v1/responses');
          sent = JSON.parse(init.body);
          return new Response(`data: ${JSON.stringify({
            type: 'response.completed',
            response: { id: 'resp_test', status: 'completed', service_tier: tier ?? 'default', output: [],
              usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } } },
          })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
        },
      }).result();
      assert.equal(result.stopReason, 'stop', result.errorMessage);
      assert.equal(sent.model, upstream);
      assert.equal(sent.service_tier, tier);
      assert.equal(sent.reasoning.effort, 'low');
      assert.equal(model.id, id);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
