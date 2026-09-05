// Run with Pi's loader so tests use the same provider modules as the extension:
// pi --no-extensions -e ./tests/pi-model-aliases.test.js --no-session -p /test-model-aliases
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import aliases from "../common/.pi/agent/extensions/gpt56-sol-aliases.ts";

// Synthetic, unsigned JWT for the local serializer test. This is not a credential.
const probeClaims = Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "acct_pi_extension_probe" },
})).toString("base64url");
const PROBE_TOKEN = `e30.${probeClaims}.sig`;
const context = { systemPrompt: "Test", messages: [{ role: "user", content: "Say OK", timestamp: 0 }] };

/** Run offline checks through the extension factory, hooks, and real provider serializers. */
export default async function (pi) {
  try {
    const providers = new Map();
    const hooks = new Map();
    await aliases({
      registerProvider: (id, config) => providers.set(id, config),
      on: (event, handler) => hooks.set(event, handler),
    });
    assert.deepEqual([...providers.keys()], ["openai-codex", "openai"]);
    const config = JSON.parse(readFileSync(new URL("../common/.pi/agent/models.json", import.meta.url), "utf8"));
    const models = Object.entries(config.providers).flatMap(([provider, config]) =>
      (config.models ?? []).map((model) => ({ ...model, provider })),
    );
    const astra = models.find((model) => model.id === "gpt-6-astra-fast");
    assert.ok(astra);
    assert.equal(astra.thinkingLevelMap.off, null);
    assert.equal(astra.thinkingLevelMap.max, "max");
    assert.equal(astra.cost.input, 10);

    let checks = 0;
    for (const [id, upstream, tier] of [
      ["gpt-6-astra-fast", "gpt-6-astra", "priority"],
      ["gpt-6-astra", "gpt-6-astra", undefined],
      ["gpt-5.6-sol-fast", "gpt-5.6-sol", "priority"],
      ["gpt-5.6-sol-1m", "gpt-5.6-sol", undefined],
    ]) {
      const model = id === "gpt-6-astra" ? { ...astra, id } : models.find((model) => model.id === id);
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
      const cases = [[false, "low"], [true, "low"], [false, "minimal"], [false, "xhigh"]];
      if (id.startsWith("gpt-6-astra")) cases.push([false, "max"]);
      else cases.push([false, undefined]); // Pi represents disabled thinking by omitting reasoning.
      for (const [withCallback, reasoning] of cases) {
        let sent;
        const stream = providers.get(model.provider).streamSimple(model, context, {
          apiKey: model.provider === "openai" ? "sk-test" : PROBE_TOKEN,
          transport: "sse",
          reasoning,
          maxRetries: 0,
          ...(withCallback ? {
            onPayload: async (payload) => {
              assert.equal(payload.model, upstream);
              assert.equal(payload.service_tier, tier);
              // Simulate a later hook trying to restore the alias or disable fast mode.
              return { ...payload, model: id, ...(tier ? { service_tier: "default" } : {}), metadata: { test: "preserved" } };
            },
          } : {}),
          fetch: async (_url, init) => {
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
        const expectedEffort = reasoning === undefined
          ? model.provider === "openai" ? "none" : undefined
          : model.thinkingLevelMap?.[reasoning] ?? reasoning;
        assert.equal(sent.reasoning?.effort, expectedEffort, `${id}: ${reasoning}`);
        if (withCallback) assert.deepEqual(sent.metadata, { test: "preserved" });
        assert.equal(model.id, id);
        hooks.get("message_end")({ message: result }, ctx);
        assert.equal(result.model, id);
        checks++;
      }
    }

    const ordinary = { ...astra, id: "gpt-6-astra" };
    const unrelated = { ...astra, provider: "other-provider" };
    const hook = hooks.get("before_provider_request");
    for (const model of [ordinary, unrelated]) {
      const payload = { model: model.id };
      assert.equal(hook({ payload }, { model }), payload);
      checks++;
    }
    const otherMessage = { role: "assistant", provider: "openai-codex", model: "gpt-5.6-sol" };
    hooks.get("message_end")({ message: otherMessage }, { model: astra });
    assert.equal(otherMessage.model, "gpt-5.6-sol");
    checks++;

    const notifications = [];
    const compact = hooks.get("session_before_compact");
    for (const model of models) {
      const ctx = { model, ui: { notify: (text) => notifications.push(text) } };
      for (const reason of ["manual", "overflow", "threshold"]) {
        const result = compact({ reason }, ctx);
        assert.deepEqual(result, model.id === "gpt-5.6-sol-1m" && reason === "threshold" ? { cancel: true } : undefined);
        checks++;
      }
    }
    assert.equal(notifications.length, 1);
    console.log(`PASS: ${checks} alias checks (offline; includes compaction's direct streamSimple path)`);
    pi.registerCommand("test-model-aliases", { description: "Run offline alias checks", handler: async () => {} });
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }
}
