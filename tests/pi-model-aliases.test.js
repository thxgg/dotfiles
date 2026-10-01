// Run with Pi's loader so tests use the same provider modules as the extension:
// pi --no-extensions -e ./tests/pi-model-aliases.test.js --no-session -p /test-model-aliases
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import aliases from "../common/.pi/agent/extensions/gpt6-sol-aliases.ts";

// An opaque OAuth-shaped sentinel for the local serializer. Never sent to a server.
const PROBE_TOKEN = "pi-openai-test-oauth";
const context = { messages: [{ role: "system", content: "Test", timestamp: 0 }, { role: "user", content: "Say OK", timestamp: 0 }] };

/** Run offline checks through the extension factory, hooks, and real provider serializers. */
export default async function (pi) {
  try {
    const providers = new Map();
    const hooks = new Map();
    await aliases({
      registerProvider: (id, config) => providers.set(id, config),
      on: (event, handler) => hooks.set(event, handler),
    });
    assert.deepEqual([...providers.keys()], ["openai"]);
    const config = JSON.parse(readFileSync(new URL("../common/.pi/agent/models.json", import.meta.url), "utf8"));
    const models = Object.entries(config.providers).flatMap(([provider, config]) =>
      (config.models ?? []).map((model) => ({ ...model, provider })),
    );
    const astra = models.find((model) => model.id === "gpt-6-astra-fast");
    assert.ok(astra);
    assert.equal(astra.thinkingLevelMap.off, null);
    assert.equal(astra.thinkingLevelMap.max, "max");
    assert.equal(astra.cost.input, 10);
    assert.equal(config.providers["openai-codex"], undefined, "no legacy chat aliases");
    assert.equal(models.some((model) => model.id === "gpt-6-sol-fast"), false);
    const sol = models.find((model) => model.id === "gpt-6.1-sol-fast");
    assert.ok(sol);
    assert.equal(sol.thinkingLevelMap.off, null);
    assert.equal(sol.cost.cacheRead, 0.1);
    const ultrafast = models.find((model) => model.id === "gpt-6-astra-ultrafast");
    assert.ok(ultrafast);
    assert.equal(ultrafast.provider, "openai");
    assert.equal(ultrafast.api, "openai-responses");
    assert.equal(ultrafast.baseUrl, "https://api.openai.com/v1");
    assert.equal(ultrafast.cost.input, 60);
    assert.equal(ultrafast.cost.output, 300);

    let checks = 0;
    for (const [id, upstream, tier] of [
      ["gpt-6-astra-fast", "gpt-6-astra", "priority"],
      ["gpt-6-astra-ultrafast", "gpt-6-astra", "ultrafast"],
      ["gpt-6-astra", "gpt-6-astra", undefined],
      ["gpt-6.1-sol-fast", "gpt-6.1-sol", "priority"],
      ["gpt-6.1-sol", "gpt-6.1-sol", undefined],
    ]) {
      const model = id === "gpt-6-astra" ? { ...astra, id }
        : id === "gpt-6.1-sol" ? { ...sol, id }
        : models.find((model) => model.id === id);
      assert.ok(model);
      const ctx = { model };
      const hook = hooks.get("before_provider_request");
      for (const payloadModel of [id, upstream]) {
        const payload = { model: payloadModel, stream: true };
        const rewritten = hook({ payload }, ctx);
        assert.equal(rewritten.model, upstream);
        assert.equal(rewritten.service_tier, tier);
        assert.equal(rewritten.stream, true);
        assert.equal(payload.model, payloadModel);
        checks++;
      }
      const cases = [[false, "low"], [true, "low"], [false, "minimal"], [false, "xhigh"], [false, "max"], [false, "off"], [false, undefined]];
      for (const [withCallback, reasoning] of cases) {
        let sent;
        const stream = providers.get(model.provider).streamSimple(model, context, {
          apiKey: PROBE_TOKEN,
          transport: "sse",
          reasoning,
          maxRetries: 0,
          maxTokens: 128,
          temperature: 0.2,
          cacheRetention: "long",
          ...(withCallback ? {
            onPayload: async (payload) => {
              assert.equal(payload.model, upstream);
              assert.equal(payload.service_tier, tier);
              // Simulate a later hook trying to restore the alias or disable its speed tier.
              return { ...payload, model: id, ...(tier ? { service_tier: "default" } : {}), metadata: { test: "preserved" } };
            },
          } : {}),
          fetch: async (url, init) => {
            assert.equal(String(url), "https://api.openai.com/v1/responses");
            assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${PROBE_TOKEN}`);
            const body = new Headers(init.headers).get("content-encoding") === "zstd"
              ? zstdDecompressSync(init.body).toString("utf8") : init.body;
            sent = JSON.parse(body);
            // Minimal successful response. No network or credentials are used.
            return new Response(`data: ${JSON.stringify({
              type: "response.completed",
              response: { id: "resp_test", status: "completed", service_tier: tier ?? "default", output: [],
                usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } } },
            })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
          },
        });
        const result = await stream.result();
        assert.equal(result.stopReason, "stop", `${id}: ${result.errorMessage}`);
        assert.equal(sent.model, upstream);
        assert.equal(sent.service_tier, tier);
        assert.equal(sent.store, false);
        assert.equal(sent.stream, true);
        assert.equal(sent.max_output_tokens, undefined, "omit unsupported subscription fields");
        assert.equal(sent.temperature, undefined);
        assert.equal(sent.prompt_cache_retention, undefined);
        const clamped = reasoning ? clampThinkingLevel(model, reasoning) : undefined;
        const expectedEffort = clamped === undefined || clamped === "off"
          ? model.thinkingLevelMap?.off ?? undefined
          : model.thinkingLevelMap?.[clamped] ?? clamped;
        assert.equal(sent.reasoning?.effort, expectedEffort, `${id}: ${reasoning}`);
        if (withCallback) assert.deepEqual(sent.metadata, { test: "preserved" });
        assert.equal(model.id, id);
        const multiplier = tier === "priority" ? 2 : 1;
        assert.ok(Math.abs(result.usage.cost.input - 10 * model.cost.input * multiplier / 1_000_000) < 1e-12);
        hooks.get("message_end")({ message: result }, ctx);
        assert.equal(result.model, id);
        checks++;
      }
    }

    const ordinary = { ...astra, id: "gpt-6-astra" };
    const unrelated = { ...astra, provider: "other-provider" };
    const hook = hooks.get("before_provider_request");
    const legacy = { ...astra, provider: "openai-codex" };
    for (const model of [ordinary, unrelated, legacy]) {
      const payload = { model: model.id };
      assert.equal(hook({ payload }, { model }), payload);
      checks++;
    }
    const otherMessage = { role: "assistant", provider: "openai", model: "gpt-6.1-sol" };
    hooks.get("message_end")({ message: otherMessage }, { model: astra });
    assert.equal(otherMessage.model, "gpt-6.1-sol");
    checks++;

    assert.equal(models.some((model) => /gpt-5\.6|-(?:pro|1m)$/.test(model.id)), false);
    assert.equal(hooks.has("session_before_compact"), false);
    checks += 2;
    console.log(`PASS: ${checks} alias checks (offline; includes compaction's direct streamSimple path)`);
    pi.registerCommand("test-model-aliases", { description: "Run offline alias checks", handler: async () => {} });
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }
}
