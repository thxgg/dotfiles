import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { zstdDecompressSync } from 'node:zlib';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

test('Ultrafast is a separate paid API alias, including direct compaction requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ultrafast-test-'));
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(dir, 'auth.json'),
      modelsStorePath: join(dir, 'models-cache.json'),
      modelsPath: fileURLToPath(new URL('../agent/models.json', import.meta.url)),
      refreshOnCreate: false,
    });
    assert.equal(runtime.getError(), undefined);
    const alias = runtime.getModel('openai', 'gpt-6-astra-ultrafast');
    const standard = runtime.getModel('openai', 'gpt-6-astra');
    assert.ok(alias);
    assert.ok(standard);
    assert.match(alias.name, /PAID API/);
    assert.equal(runtime.getModel('openai-codex', alias.id), undefined);
    assert.ok(runtime.getModel('openai-codex', 'gpt-6-astra-fast'));
    assert.equal(standard.samplingParams?.service_tier, undefined);
    assert.equal(alias.cost.input, 60);
    assert.equal(alias.cost.output, 300);

    for (const model of [alias, standard]) {
      for (const reasoning of ['low', 'max']) {
        let sent;
        const before = structuredClone(model);
        // No extension hooks: compaction calls this same runtime path.
        const result = await runtime.streamSimple(model, {
          messages: [{ role: 'user', content: 'Say OK', timestamp: 0 }],
        }, {
          apiKey: 'sk-test', env: {}, reasoning, maxRetries: 0,
          fetch: async (url, init) => {
            assert.equal(String(url), 'https://api.openai.com/v1/responses');
            const body = new Headers(init.headers).get('content-encoding') === 'zstd'
              ? zstdDecompressSync(init.body).toString('utf8') : init.body;
            sent = JSON.parse(body);
            return new Response(`data: ${JSON.stringify({
              type: 'response.completed',
              response: {
                id: 'resp_test', model: 'gpt-6-astra', status: 'completed',
                service_tier: model === alias ? 'ultrafast' : 'default', output: [],
                usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } },
              },
            })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
          },
        }).result();
        assert.equal(result.stopReason, 'stop', result.errorMessage);
        assert.equal(sent.model, 'gpt-6-astra');
        assert.equal(sent.service_tier, model === alias ? 'ultrafast' : undefined);
        assert.equal(sent.reasoning.effort, reasoning);
        assert.equal(result.model, model.id, 'session messages retain the picker identity');
        assert.ok(Math.abs(result.usage.cost.input - 10 * model.cost.input / 1_000_000) < 1e-12);
        assert.ok(Math.abs(result.usage.cost.output - model.cost.output / 1_000_000) < 1e-12);
        assert.deepEqual(model, before);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
