// Manual opt-in integration probe. Never runs in `npm test`.
// Uses real OpenAI allowance. Copies source history; never modifies the source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import extension from '../agent/extensions/zz-background-compaction.ts';
import aliases from '../agent/extensions/gpt6-sol-aliases.ts';

const [source, checkpoint, directory, requestedCase = 'ready'] = process.argv.slice(2);
if (!source || !checkpoint || !directory || process.env.PI_LIVE_COMPACTION !== '1') {
  console.error('Uses real OpenAI allowance. PI_LIVE_COMPACTION=1 node --import tsx test/live-background-compaction.mjs <source.jsonl> <checkpoint-id> <private-output-dir> [ready|inflight|cancel]');
  process.exit(2);
}
assert.ok(['ready', 'inflight', 'cancel'].includes(requestedCase));
const output = resolve(directory);
assert.equal(existsSync(output), false, 'choose a new output directory; never overwrite prior evidence');
mkdirSync(output, { recursive: true, mode: 0o700 });
const bytes = readFileSync(source);
const sourceHash = createHash('sha256').update(bytes).digest('hex');
const entries = bytes.toString().trim().split('\n').map(line => JSON.parse(line));
const byId = new Map(entries.filter(entry => entry.id).map(entry => [entry.id, entry]));
const branch = [];
for (let entry = byId.get(checkpoint); entry; entry = byId.get(entry.parentId)) branch.unshift(entry);
assert.equal(branch.at(-1)?.id, checkpoint, 'checkpoint must exist');
assert.equal(branch.at(-1)?.message?.role, 'assistant', 'use a completed assistant checkpoint');
const fixture = join(output, 'session.jsonl');
const cwd = join(output, 'work');
const agentDir = join(output, 'agent');
mkdirSync(cwd, { recursive: true, mode: 0o700 });
mkdirSync(agentDir, { recursive: true, mode: 0o700 });
// Independent identity/storage. Original entry IDs remain for /tree-style replay.
const manager = SessionManager.create(cwd, output);
const header = manager.getHeader();
writeFileSync(fixture, [header, ...branch].map(entry => JSON.stringify(entry)).join('\n') + '\n', { mode: 0o600 });
const sessionManager = SessionManager.open(fixture);
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  cacheWarming: 'off', retry: { enabled: false }, transport: 'sse',
  defaultThinkingLevel: 'low',
});
const report = { source, sourceHash, checkpoint, case: requestedCase, events: [], foreground: [], compactions: [] };
const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const log = (type, value) => { console.log(JSON.stringify({ type, ...value })); save(); };
let wire;
let foregroundRequests = 0;
const resourceLoader = new DefaultResourceLoader({
  cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true,
  noThemes: true, noContextFiles: true,
  extensionFactories: [aliases, pi => {
    // Block execution at the real tool boundary while keeping normal declarations.
    pi.on('tool_call', () => ({ block: true, reason: 'Read-only compaction probe: all tools are disabled.' }));
    pi.on('before_provider_request', event => {
      foregroundRequests++;
      assert.ok(foregroundRequests <= 8, 'live test foreground request budget exhausted');
      // The probe has no reason to run tools; enforce at the provider too.
      const payload = { ...event.payload, tool_choice: 'none' };
      wire = {
        prefixHash: createHash('sha256').update(JSON.stringify(payload.input)).digest('hex'),
        prefixItems: payload.input?.length,
        cacheKeyHash: createHash('sha256').update(JSON.stringify(payload.prompt_cache_key ?? null)).digest('hex'),
      };
      return payload;
    });
    pi.events.on('background-compaction', event => {
      report.events.push({ at: Date.now(), ...event });
      log('background', event);
    });
  }, extension],
});
await resourceLoader.reload();
// Use the existing auth store; no credentials are copied into the test artifacts.
const modelRuntime = await ModelRuntime.create({
  authPath: join(homedir(), '.pi/agent/auth.json'),
  modelsPath: join(homedir(), '.pi/agent/models.json'),
});
const models = await modelRuntime.getAvailable();
const model = models.find(model => model.provider === 'openai' && model.id === (process.env.PI_LIVE_MODEL ?? 'gpt-6-astra'));
assert.ok(model, 'OpenAI Astra must be available');
report.model = { provider: model.provider, id: model.id, contextWindow: model.contextWindow };
const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model, settingsManager, resourceLoader, sessionManager, thinkingLevel: 'low' });
session.subscribe(event => {
  if (event.type === 'message_end' && event.message.role === 'assistant') {
    const message = event.message;
    const item = { at: Date.now(), usage: message.usage, stopReason: message.stopReason, wire };
    report.foreground.push(item);
    log('foreground', item);
  }
  if (event.type === 'compaction_start') report.compactionStartedAt = Date.now();
  if (event.type === 'compaction_end') {
    const item = { reason: event.reason, aborted: event.aborted, errorMessage: event.errorMessage,
      elapsedMs: report.compactionStartedAt ? Date.now() - report.compactionStartedAt : undefined,
      tokensBefore: event.result?.tokensBefore, estimatedTokensAfter: event.result?.estimatedTokensAfter };
    report.compactions.push(item);
    log('compaction', item);
  }
});

function filler(count) {
  const words = ['amber', 'birch', 'cedar', 'dawn', 'elm', 'fern', 'grove', 'hill', 'iris', 'jade', 'kite', 'lake', 'moss', 'north', 'oak', 'pine'];
  let n = 7321;
  return Array.from({ length: count }, () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return words[n >>> 28]; }).join(' ');
}
async function prompt(padding = 0) {
  await session.prompt(`This is a read-only context-compaction test. Do not continue the earlier task. Do not use tools. Reply with only BG_PROBE_OK. The following inert test data may be ignored.\n${filler(padding)}\nEnd of inert test data. Reply with only BG_PROBE_OK.`);
  const last = report.foreground.at(-1);
  assert.equal(last?.stopReason, 'stop', 'foreground request must succeed');
  log('context', session.getContextUsage());
}
async function waitReady() {
  const end = Date.now() + 305_000;
  while (!report.events.some(event => event.stage === 'ready')) {
    assert.ok(Date.now() < end, 'background summary did not become ready');
    await delay(100);
  }
}
try {
  await session.bindExtensions({});
  const initialNavigation = await session.navigateTree(checkpoint, { summarize: false });
  assert.equal(initialNavigation.cancelled, false);
  log('initial', { ...report.model, context: session.getContextUsage(), fixture });
  await prompt();
  for (let n = 0; n < 2 && !report.events.some(event => event.stage === 'started'); n++) await prompt(4000);
  assert.ok(report.events.some(event => event.stage === 'started'), 'background preparation must start');
  if (requestedCase === 'cancel') {
    const navigation = await session.navigateTree(checkpoint, { summarize: false });
    assert.equal(navigation.cancelled, false);
    await delay(500);
    assert.equal(report.events.some(event => event.stage === 'applied'), false);
    report.outcome = 'cancelled by /tree-equivalent navigation';
  } else {
    if (requestedCase === 'ready') await waitReady();
    const summaryStart = report.events.find(event => event.stage === 'started');
    report.thresholdProbeStarted = Date.now();
    const tokens = session.getContextUsage()?.tokens ?? 0;
    const missing = Math.max(1000, model.contextWindow - 16_384 - tokens + 2500);
    // This word set averages ~1.5 provider tokens/word. Keep the appended tail
    // under the extension's 40k-token retention cap; at most two bounded attempts.
    await prompt(Math.min(17_000, Math.ceil(missing / 1.5)));
    if (!report.events.some(event => event.stage === 'applied')) await prompt(3000);
    assert.ok(report.events.some(event => event.stage === 'applied'), 'must apply a held summary');
    assert.equal(report.events.filter(event => event.stage === 'started').length, 1, 'reuse one summary job');
    const beforeContinue = session.sessionManager.buildSessionProjection().messages;
    assert.ok(beforeContinue.some(message => message.role === 'compactionSummary'));
    assert.ok(JSON.stringify(beforeContinue).includes('inert test data'), 'retain the exact follow-up messages');
    await prompt();
    const summary = report.events.find(event => event.stage === 'summary_finished');
    assert.equal(summary?.mode, 'openai-prefix');
    assert.ok(summary.usage.cacheRead > 0, 'provider must report a cache read');
    assert.ok(report.foreground.some(item => item.wire?.prefixHash === summary.prefixHash && item.wire?.cacheKeyHash === summary.cacheKeyHash), 'summary must use an actual foreground prefix and cache key');
    const after = session.getContextUsage();
    assert.ok(after.tokens < (model.contextWindow - 16_384) * 0.85, 'context must fall below precompute threshold');
    report.outcome = 'applied with provider-verified cache reuse';
    report.finalContext = after;
    report.summaryStart = summaryStart;
  }
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
  session.dispose();
  assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), sourceHash, 'source history must not change');
  save();
}
