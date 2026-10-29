import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'pi-background-compaction-'));
const agentDir = join(root, 'agent');
const cwd = join(root, 'work');
mkdirSync(agentDir);
mkdirSync(cwd);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = '1';
after(() => rmSync(root, { recursive: true, force: true }));

const { default: extension } = await import('../agent/extensions/zz-background-compaction.ts');
const { SessionManager, SettingsManager, DefaultResourceLoader, ModelRuntime, createAgentSession } = await import('@earendil-works/pi-coding-agent');
const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai/providers/faux');
const { AssistantMessageEventStream } = await import('@earendil-works/pi-ai');

const settings = { compaction: { enabled: true, reserveTokens: 16_000, keepRecentTokens: 20_000 }, cacheWarming: 'off', retry: { enabled: false } };
const model = { id: 'test', provider: 'test', api: 'test', contextWindow: 100_000, maxTokens: 16_000, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const usage = (input) => ({ input, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: input + 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const assistant = (text, tokens = 74_000) => ({ ...fauxAssistantMessage(text), model: 'test', provider: 'test', api: 'test', usage: usage(tokens) });
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ config = settings, tokens = 74_000, measured = 74_000 } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const requests = [];
  const statuses = [];
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: 'system', content: 'Fixture instructions.', timestamp: 0 });
  manager.appendMessage({ role: 'user', content: 'OLD GOAL: preserve the request and file a.ts', timestamp: 1 });
  manager.appendMessage(assistant('Prior progress', 60_000));
  manager.appendMessage({ role: 'user', content: 'Continue the original request.', timestamp: 3 });
  const anchor = manager.appendMessage(assistant('LATEST RESPONSE', measured));
  let currentSettings = structuredClone(config);
  let activeTools = [];
  const ctx = {
    cwd, model: structuredClone(model), thinkingLevel: 'off', mode: 'print', hasUI: false,
    sessionManager: manager, signal: undefined,
    ui: { setStatus: (_key, text) => statuses.push(text), notify: text => statuses.push(text) },
    getSystemPrompt: () => 'Fixture instructions.',
    getContextUsage: () => ({ tokens, contextWindow: model.contextWindow, percent: tokens / 1000 }),
    modelRegistry: {
      streamSimple: (requestModel, context, options) => {
        const stream = new AssistantMessageEventStream();
        requests.push({ requestModel, context, options, stream });
        return stream;
      },
    },
  };
  const pi = {
    on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit: () => {} },
    registerCommand: (name, command) => commands.set(name, command),
    getSettings: () => currentSettings,
    getActiveTools: () => activeTools,
    getAllTools: () => activeTools.map(name => ({ name, description: name, parameters: { type: 'object' } })),
  };
  extension(pi);
  const emit = (name, event = {}) => handlers.get(name)?.({ type: name, ...event }, ctx);
  const begin = async () => { await emit('turn_end', { outcome: 'completed' }); await tick(); };
  const finish = async (index = requests.length - 1, stopReason = 'stop', text = 'BACKGROUND CHECKPOINT') => {
    const response = { ...assistant(text, 10_000), stopReason };
    if (stopReason === 'error' || stopReason === 'aborted') requests[index].stream.push({ type: 'error', reason: stopReason, error: response });
    else requests[index].stream.push({ type: 'done', reason: stopReason, message: response });
    requests[index].stream.end();
    await tick();
  };
  const compact = (extra = {}) => emit('session_before_compact', {
    reason: 'threshold', willRetry: false, signal: new AbortController().signal,
    preparation: { settings: SettingsManager.inMemory(currentSettings).getCompactionSettings(ctx.model), tokensBefore: 85_000 },
    branchEntries: manager.getBranch(), ...extra,
  });
  return { ctx, manager, anchor, requests, statuses, emit, begin, finish, compact, commands,
    setConfig: value => { currentSettings = value; },
    setTools: value => { activeTools = value; },
  };
}

test('real offline CLI loads the standalone extension and exposes its command', () => {
  const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
  const path = fileURLToPath(new URL('../agent/extensions/zz-background-compaction.ts', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '-ne', '-e', path, '-ns', '-np', '-nc', '--no-session', '--offline', '--no-tools', '-p', '/bg-compact'], {
    cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' }, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /Failed to load extension|Extension error|Unknown command/);
});

test('precompute does not block or change history; swap preserves the exact tail and usage', async () => {
  const h = harness();
  const before = h.manager.getBranch();
  await h.begin();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.manager.getBranch(), before);
  const request = h.requests[0];
  assert.match(JSON.stringify(request.context), /OLD GOAL/);
  assert.doesNotMatch(JSON.stringify(request.context), /LATEST RESPONSE/);
  assert.equal(request.options.maxTokens, 8192);
  assert.equal(request.options.cacheRetention, 'none');
  assert.match(request.options.sessionId, /-background-compaction$/);
  h.manager.appendMessage({ role: 'user', content: 'NEW EXACT REQUEST', timestamp: 10 });
  const call = { ...assistant(fauxToolCall('read', { path: 'a.ts' }, { id: 'call' })), stopReason: 'toolUse' };
  h.manager.appendMessage(call);
  h.manager.appendMessage({ role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'EXACT TOOL RESULT' }], isError: false, timestamp: 11 });
  await h.emit('turn_end', { outcome: 'completed' });
  assert.equal(h.requests.length, 1, 'only one request in flight');
  await h.finish();
  const { compaction } = await h.compact();
  assert.equal(compaction.firstKeptEntryId, h.anchor);
  assert.equal(compaction.tokensBefore, 85_000);
  assert.deepEqual(compaction.usage, usage(10_000));
  const tail = h.manager.getBranch().slice(h.manager.getBranch().findIndex(entry => entry.id === h.anchor));
  h.manager.appendCompaction(compaction.summary, compaction.firstKeptEntryId, compaction.tokensBefore, compaction.details, true, compaction.usage);
  const projected = h.manager.buildSessionProjection().messages;
  assert.match(JSON.stringify(projected), /BACKGROUND CHECKPOINT/);
  assert.doesNotMatch(JSON.stringify(projected), /OLD GOAL/);
  assert.deepEqual(projected.slice(-tail.length), tail.map(entry => entry.message));
  assert.equal(h.requests.length, 1, 'swap made no second model request');
});

test('background lifecycle stays silent in the TUI; explicit status still works', async () => {
  const h = harness();
  h.ctx.hasUI = true;
  await h.emit('session_start');
  await h.begin();
  assert.equal(h.requests.length, 1);
  await h.finish();
  assert.ok((await h.compact()).compaction);
  await h.emit('session_compact');
  assert.deepEqual(h.statuses, []);
  await h.commands.get('bg-compact').handler('status', h.ctx);
  assert.match(h.statuses.at(-1), /Background compaction: idle/);
});

test('background failures and invalid settings stay silent in the TUI', async () => {
  const h = harness();
  h.ctx.hasUI = true;
  await h.begin();
  await h.finish(0, 'error');
  assert.equal(await h.compact(), undefined);
  h.setConfig({ compaction: { reserveTokens: -1 } });
  await h.begin();
  assert.deepEqual(h.statuses, []);
});

test('threshold waits for the existing summary, not another request', async () => {
  const h = harness();
  await h.begin();
  let settled = false;
  const result = h.compact().then(value => { settled = true; return value; });
  await tick();
  assert.equal(settled, false);
  await h.finish();
  assert.ok((await result).compaction);
  assert.equal(h.requests.length, 1);
});

for (const [name, options] of [
  ['below the start threshold', { tokens: 70_000 }],
  ['at the native threshold', { tokens: 84_000 }],
  ['no measured large prompt', { measured: 63_999 }],
  ['automatic compaction disabled', { config: { compaction: { enabled: false } } }],
  ['invalid settings', { config: { compaction: { reserveTokens: -1 } } }],
  ['per-model budget not reached', { config: { compaction: { reserveTokens: 40_000, modelOverrides: { 'test/test': { reserveTokens: 0 } } } } }],
]) test(`no background request: ${name}`, async () => {
  const h = harness(options);
  await h.begin();
  assert.equal(h.requests.length, 0);
});

test('effective per-model and runtime settings are honored', async () => {
  const h = harness({ tokens: 65_000, measured: 65_000, config: { compaction: { reserveTokens: 0, modelOverrides: { 'test/test': { reserveTokens: 25_000 } } } } });
  await h.begin();
  assert.equal(h.requests.length, 1);
  h.setConfig({ compaction: { enabled: false } });
  await h.emit('agent_settled', { aborted: false });
  assert.equal(h.requests[0].options.signal.aborted, true);
});

for (const mutation of ['model', 'prompt', 'tools', 'prefix edit', 'tail too long', 'branch', 'settings']) {
  test(`stale checkpoint falls back: ${mutation}`, async () => {
    const h = harness();
    await h.begin();
    await h.finish();
    if (mutation === 'model') h.ctx.model.id = 'changed';
    if (mutation === 'prompt') h.ctx.getSystemPrompt = () => 'Changed instructions';
    if (mutation === 'tools') h.setTools(['new-tool']);
    if (mutation === 'prefix edit') h.manager.appendContextEdit(h.manager.getBranch()[1].id, { content: 'REVISED GOAL' });
    if (mutation === 'tail too long') h.manager.appendMessage({ role: 'user', content: 'x'.repeat(90_000), timestamp: 20 });
    if (mutation === 'branch') h.manager.branch(h.manager.getBranch()[1].id);
    if (mutation === 'settings') h.setConfig({ compaction: { reserveTokens: 17_000 } });
    assert.equal(await h.compact(), undefined);
  });
}

for (const event of ['session_shutdown', 'session_before_switch', 'session_before_fork', 'session_before_tree', 'model_select', 'session_compact']) {
  test(`${event} aborts pending work and rejects late results`, async () => {
    const h = harness();
    await h.begin();
    await h.emit(event);
    assert.equal(h.requests[0].options.signal.aborted, true);
    await h.finish();
    assert.equal(await h.compact(), undefined);
  });
}

for (const reason of ['manual', 'overflow']) test(`${reason} uses native compaction`, async () => {
  const h = harness();
  await h.begin();
  assert.equal(await h.compact({ reason }), undefined);
  assert.equal(h.requests[0].options.signal.aborted, true);
  await h.finish();
});

test('abort during a threshold wait resolves even if a provider ignores abort', async () => {
  const h = harness();
  await h.begin();
  const controller = new AbortController();
  const pending = h.compact({ signal: controller.signal });
  controller.abort();
  assert.equal(await pending, undefined);
  assert.equal(h.requests[0].options.signal.aborted, true);
  await h.finish();
});

for (const [reason, text] of [['error', 'provider failure'], ['length', 'partial'], ['aborted', 'partial'], ['stop', '   ']]) {
  test(`${reason} / ${JSON.stringify(text)} does not become a checkpoint or retry the same anchor`, async () => {
    const h = harness();
    await h.begin();
    await h.finish(0, reason, text);
    await h.emit('agent_settled', { aborted: false });
    assert.equal(h.requests.length, 1);
    assert.equal(await h.compact(), undefined);
  });
}

test('timeout releases a compaction wait even when the provider does not settle', async (t) => {
  const h = harness();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await h.begin();
  const waiting = h.compact();
  t.mock.timers.tick(300_000);
  assert.equal(await waiting, undefined);
  assert.equal(h.requests[0].options.signal.aborted, true);
  await h.finish();
});

test('two failed summaries stop new requests until compaction resets the budget', async () => {
  const h = harness();
  await h.begin();
  await h.finish(0, 'error');
  h.manager.appendMessage(assistant('SECOND ANCHOR'));
  await h.begin();
  await h.finish(1, 'length');
  h.manager.appendMessage(assistant('THIRD ANCHOR'));
  await h.begin();
  assert.equal(h.requests.length, 2);
  await h.emit('session_compact');
  await h.begin();
  assert.equal(h.requests.length, 3);
  await h.finish();
});

test('a stale tail starts a newer summary while below the native threshold', async () => {
  const h = harness();
  await h.begin();
  await h.finish();
  h.manager.appendMessage({ role: 'user', content: 'x'.repeat(90_000), timestamp: 20 });
  const next = h.manager.appendMessage(assistant('NEW ANCHOR'));
  await h.begin();
  assert.equal(h.requests.length, 2);
  await h.finish();
  assert.equal((await h.compact()).compaction.firstKeptEntryId, next);
});

test('a summary that cannot make room falls back', async () => {
  const h = harness();
  await h.begin();
  await h.finish(0, 'stop', 'x'.repeat(300_000));
  assert.equal(await h.compact(), undefined);
});

test('off cancels work; on is session-local and can start again', async () => {
  const h = harness();
  await h.begin();
  await h.commands.get('bg-compact').handler('off', h.ctx);
  await h.emit('agent_settled', { aborted: false });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.signal.aborted, true);
  await h.commands.get('bg-compact').handler('on', h.ctx);
  await tick();
  assert.equal(h.requests.length, 2);
  await h.finish(0, 'stop', 'OLD STALE RESULT');
  await h.finish(1);
  assert.equal((await h.compact()).compaction.summary, 'BACKGROUND CHECKPOINT');
});

test('repeated compaction updates the previous summary and retained history', async () => {
  const h = harness();
  await h.begin();
  await h.finish();
  const first = (await h.compact()).compaction;
  h.manager.appendCompaction(first.summary, first.firstKeptEntryId, first.tokensBefore, first.details, true, first.usage);
  await h.emit('session_compact');
  h.manager.appendMessage({ role: 'user', content: 'NEXT REQUEST', timestamp: Date.now() });
  h.manager.appendMessage(assistant('SECOND ANCHOR'));
  await h.begin();
  assert.equal(h.requests.length, 2);
  const prompt = JSON.stringify(h.requests[1].context);
  assert.match(prompt, /BACKGROUND CHECKPOINT/);
  assert.match(prompt, /LATEST RESPONSE/);
  assert.match(prompt, /NEXT REQUEST/);
  assert.doesNotMatch(prompt, /SECOND ANCHOR/);
  await h.finish();
});

test('OpenAI summary preserves the captured wire prefix, tools, cache key, and generation settings', async () => {
  const h = harness();
  h.ctx.model = { ...model, provider: 'openai', api: 'openai-responses' };
  // Capture before the latest response is persisted, as in Pi's actual lifecycle.
  h.manager.branch(h.manager.getEntry(h.anchor).parentId);
  const original = {
    model: 'gpt-6-astra', stream: true, store: false, prompt_cache_key: 'same-session',
    input: [{ role: 'developer', content: 'TRANSFORMED SYSTEM' }, { role: 'user', content: 'WIRE HISTORY' }],
    tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }],
    reasoning: { effort: 'low', summary: 'auto' }, service_tier: 'priority',
  };
  await h.emit('before_provider_request', { payload: original });
  h.manager.appendMessage({ ...assistant('LATEST RESPONSE'), provider: 'openai' });
  await h.begin();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  const outgoing = request.options.onPayload({ model: 'unused', input: [] });
  assert.deepEqual(outgoing.input.slice(0, -1), original.input);
  for (const key of ['tools', 'reasoning', 'service_tier', 'prompt_cache_key', 'model']) assert.deepEqual(outgoing[key], original[key]);
  assert.equal(outgoing.tool_choice, 'none');
  assert.equal('max_output_tokens' in outgoing, false, 'do not add a field rejected by subscription auth');
  assert.equal(request.options.sessionId, h.manager.getSessionId());
  assert.equal(request.options.cacheRetention, 'short');
  assert.match(outgoing.input.at(-1).content[0].text, /checkpoint/);
  assert.deepEqual(original.input.length, 2, 'leave original request intact');
  await h.finish();
  assert.ok((await h.compact()).compaction);
});

test('real OpenAI serializer receives the transformed prefix unchanged through the SDK', async () => {
  const { streamSimple } = await import('@earendil-works/pi-ai/api/openai-responses');
  const settingsManager = SettingsManager.inMemory(settings);
  const requests = [];
  let requestNumber = 0;
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [pi => {
      pi.on('before_provider_request', event => ({ ...event.payload, service_tier: 'priority' }));
    }, extension],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth-offline.json'), modelsPath: join(agentDir, 'models-offline.json') });
  modelRuntime.registerProvider('openai', {
    apiKey: 'synthetic-oauth', api: 'openai-responses',
    models: [{ id: 'prefix-fixture', name: 'Prefix fixture', api: 'openai-responses', reasoning: false, input: ['text'], cost: model.cost, contextWindow: 100_000, maxTokens: 16_000 }],
    streamSimple: (model, context, options) => streamSimple(model, context, {
      ...options, apiKey: 'synthetic-oauth',
      fetch: async (_url, init) => {
        const payload = JSON.parse(init.body);
        requests.push(payload);
        const n = ++requestNumber;
        const text = n === 1 ? 'FOREGROUND' : 'CACHED SUMMARY';
        const item = { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] };
        const events = [
          { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
          { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
          { type: 'response.output_item.done', output_index: 0, item },
          { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: 74_000, output_tokens: 10, input_tokens_details: { cached_tokens: n === 1 ? 0 : 73_984 } } } },
        ];
        return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
      },
    }),
  });
  const sessionModel = modelRuntime.getAvailableSnapshot().find(model => model.id === 'prefix-fixture');
  assert.ok(sessionModel);
  const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, settingsManager, modelRuntime, model: sessionModel, sessionManager: SessionManager.inMemory(cwd) });
  try {
    await session.bindExtensions({});
    await session.prompt('ORIGINAL INPUT');
    for (let n = 0; n < 20 && requests.length < 2; n++) await tick();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].input.slice(0, -1), requests[0].input);
    assert.deepEqual(requests[1].tools, requests[0].tools);
    assert.equal(requests[1].prompt_cache_key, requests[0].prompt_cache_key);
    assert.equal(requests[1].service_tier, 'priority');
    assert.equal(requests[1].tool_choice, 'none');
    assert.equal('max_output_tokens' in requests[1], false);
  } finally {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
    session.dispose();
  }
});

test('OpenAI does not silently use a reformatted summary without a current wire snapshot', async () => {
  const h = harness();
  h.ctx.model = { ...model, provider: 'openai', api: 'openai-responses' };
  h.manager.appendMessage({ ...assistant('LATEST'), provider: 'openai' });
  await h.begin();
  assert.equal(h.requests.length, 0);
});

test('real SDK automatic compaction uses the held summary and continues without another summary call', { timeout: 15_000 }, async () => {
  const settingsManager = SettingsManager.inMemory(settings);
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [extension, pi => {
      // Faux estimates (and double-counts initial cache writes) from text. Supply
      // measured usage through the public final-message hook for deterministic thresholds.
      pi.on('message_end', event => {
        if (event.message.role !== 'assistant') return;
        const text = event.message.content.find(block => block.type === 'text')?.text;
        return { message: { ...event.message, usage: usage(text === 'NOW OVER THRESHOLD' ? 86_000 : text === 'CONTINUED' ? 2_000 : 74_000) } };
      });
    }],
  });
  await resourceLoader.reload();
  const faux = fauxProvider({ provider: 'test', api: 'test', models: [{ id: 'test', contextWindow: 100_000, maxTokens: 16_000 }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json') });
  modelRuntime.registerNativeProvider(faux.provider);
  const { session } = await createAgentSession({
    cwd, agentDir, resourceLoader, settingsManager, modelRuntime,
    model: faux.getModel(), sessionManager: SessionManager.inMemory(cwd),
  });
  const events = [];
  session.subscribe(event => events.push(event));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const summaryStarted = new Promise(resolve => { started = resolve; });
  let nextContext;
  faux.setResponses([
    () => assistant('LATEST RESPONSE'),
    async () => { started(); await gate; return assistant('SDK BACKGROUND CHECKPOINT', 10_000); },
    () => assistant('NOW OVER THRESHOLD', 86_000),
    context => { nextContext = context; return assistant('CONTINUED', 2_000); },
  ]);
  try {
    await session.bindExtensions({});
    await session.prompt('OLD SDK GOAL ' + 'x'.repeat(285_000));
    await summaryStarted;
    assert.equal(faux.state.callCount, 2);
    assert.equal(session.sessionManager.getBranch().some(entry => entry.type === 'compaction'), false);
    release();
    await tick();
    await session.prompt('EXACT FOLLOW UP ' + 'y'.repeat(80_000));
    assert.equal(session.model.contextWindow, 100_000);
    await session.prompt('CONTINUE AFTER COMPACTION');
    const compactions = session.sessionManager.getBranch().filter(entry => entry.type === 'compaction');
    assert.equal(compactions.length, 1);
    assert.equal(compactions[0].fromHook, true);
    assert.equal(compactions[0].summary, 'SDK BACKGROUND CHECKPOINT');
    assert.equal(faux.state.callCount, 4, 'two foreground turns, one summary, one continuation');
    assert.match(JSON.stringify(nextContext), /SDK BACKGROUND CHECKPOINT/);
    assert.match(JSON.stringify(nextContext), /EXACT FOLLOW UP/);
    assert.match(JSON.stringify(nextContext), /LATEST RESPONSE/);
    assert.doesNotMatch(JSON.stringify(nextContext), /OLD SDK GOAL/);
    assert.ok(events.some(event => event.type === 'compaction_end'));
  } finally {
    release();
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
    session.dispose();
  }
});
