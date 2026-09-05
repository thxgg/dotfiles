# Pi model alias checks

Run from the repository root with Pi installed:

```sh
pi --no-extensions -e ./tests/pi-model-aliases.test.js --no-skills --no-prompt-templates --no-context-files --no-session -p /test-model-aliases
```

The tests load the extension through Pi. They use the real provider serializers with a local `fetch` replacement. They do not send model requests or use real credentials. They check:

- Astra Fast, Sol Fast, and Sol 1M model rewriting.
- Priority processing for fast aliases only.
- Normal Astra requests without priority processing.
- Reasoning-level translation, including Astra Max.
- Payload callbacks and alias restoration in completed messages.
- The direct `streamSimple` path used for compaction.
- Sol 1M compaction cancellation without changing Astra compaction.

Do not use `--list-models` to run these tests. Pi can hide extension-load errors and exit successfully in that mode.

## Astra Fast usage

The existing `common/.pi/agent/extensions/gpt56-sol-aliases.ts` extension handles both Sol and Astra. Do not load a second copy of its provider wrappers.

After `/reload`, select:

```text
/model openai-codex/gpt-6-astra-fast
```

The alias sends `model: "gpt-6-astra"` and `service_tier: "priority"`. Reasoning effort remains a separate setting. The model uses a conservative 272,000-token context window and normal auto-compaction. It does not inherit the Sol 1M compaction exception.

The rates in `models.json` are standard token rates, not ChatGPT credit accounting. Pi applies its own service-tier cost multiplier. Its displayed cost is an estimate; use OpenAI's usage records for actual charges. [Codex fast mode](https://developers.openai.com/codex/speed/) lists Astra at 2.5 times Standard credit consumption where available.

## Live verification result

A short request through the extension returned HTTP 200 and `ASTRA_OK`:

- Request model: `gpt-6-astra`
- Request service tier: `priority`
- Request reasoning effort: `low`
- Response model: `gpt-6-astra`
- Response service tier: `default`
- Response status: `completed`

This confirms that the alias works and sends the priority request option. It does **not** confirm that the server granted priority processing or improved speed. Pi's Codex provider treats a returned `default` tier as the requested tier for cost estimation, so its cost display is not independent proof of fast mode.
