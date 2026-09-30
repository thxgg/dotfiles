import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'pi-codemode-test-'));
const agentDir = join(root, 'agent');
const cwd = join(root, 'work');
mkdirSync(agentDir);
mkdirSync(cwd);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = '1';
delete process.env.BASH_ENV;
delete process.env.ENV;
for (const name of Object.keys(process.env)) {
  if (name.startsWith('BASH_FUNC_')) delete process.env[name];
}
after(() => rmSync(root, { recursive: true, force: true }));

const { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai/providers/faux');
const { default: gitGuard } = await import('../agent/extensions/git-interceptor.ts');
const { default: cloak } = await import('../agent/extensions/pi-cloak/index.ts');
const { default: verbosity } = await import('../agent/extensions/verbosity-level/index.ts');
const { default: sanitizeAnthropic } = await import('../agent/extensions/anthropic-prompt-sanitizer.ts');

test('Anthropic request sanitation preserves the canonical session and tool declarations', async () => {
  const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off', retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [sanitizeAnthropic],
  });
  await resourceLoader.reload();
  const faux = fauxProvider({ provider: 'anthropic' });
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json') });
  modelRuntime.registerNativeProvider(faux.provider);
  const { session } = await createAgentSession({
    cwd, agentDir, resourceLoader, settingsManager, modelRuntime,
    model: faux.getModel(), sessionManager: SessionManager.inMemory(cwd),
  });
  let request;
  faux.setResponses([context => { request = context; return fauxAssistantMessage('Done'); }]);
  try {
    await session.bindExtensions({});
    await session.prompt('Fixture');
    assert.ok(request);
    assert.equal(request.messages[0].role, 'system');
    assert.doesNotMatch(JSON.stringify(request), /Pi documentation/);
    assert.ok(request.messages[0].toolsAdded.some(tool => tool.name === 'read'));
    assert.match(JSON.stringify(session.sessionManager.getBranch()), /Pi documentation/);
  } finally {
    session.dispose();
  }
});

test('native codemode preserves local guards, redaction, structured bash results, and direct tools', async () => {
  writeFileSync(join(agentDir, 'cloak.json'), JSON.stringify({ patterns: [{ filePattern: '**/.env', cloakPattern: 'value-to-mask' }] }));
  writeFileSync(join(cwd, '.env'), 'KEY=value-to-mask');
  const settingsManager = SettingsManager.inMemory({
    defaultTools: ['+codemode'], shellPath: '/bin/sh', shellCommandPrefix: '',
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off',
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [createCodemodeExtension({ mode: 'on' }), gitGuard, cloak, verbosity],
  });
  await resourceLoader.reload();
  const faux = fauxProvider();
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json') });
  modelRuntime.registerNativeProvider(faux.provider);
  const { session } = await createAgentSession({
    cwd, agentDir, resourceLoader, settingsManager, modelRuntime,
    model: faux.getModel(), sessionManager: SessionManager.inMemory(cwd),
  });
  const events = [];
  session.subscribe(event => events.push(event));
  try {
    await session.bindExtensions({});
    for (const name of ['read', 'bash', 'edit', 'write', 'codemode']) assert.ok(session.getActiveToolNames().includes(name), name);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('codemode', { code: `
        const masked = await tools.read({ path: '.env' });
        let blocked;
        try { await tools.bash({ command: 'git status --no-verify' }); }
        catch (error) { blocked = error.message; }
        const shell = await tools.bash({ command: "# git editor check\\nprintf '%s/%s/%s' \\"$GIT_EDITOR\\" \\"$GIT_SEQUENCE_EDITOR\\" \\"$GIT_MERGE_AUTOEDIT\\"" });
        return { masked, blocked, shell };
      ` }, { id: 'batch' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Done'),
    ]);
    await session.prompt('Run the scripted offline fixture.');
    const result = session.messages.find(message => message.role === 'toolResult' && message.toolName === 'codemode');
    assert.ok(result);
    assert.equal(result.isError, false, JSON.stringify(result.content));
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    assert.match(text, /KEY=v\*+/);
    assert.doesNotMatch(text, /value-to-mask/);
    assert.match(text, /BLOCKED: --no-verify/);
    assert.match(text, /true\/true\/no/);
    assert.match(text, /exit_code/);
    const nested = events.filter(event => event.type === 'tool_execution_end' && event.parentToolCallId === 'batch');
    assert.equal(nested.length, 3);
    assert.equal(nested.filter(event => event.isError).length, 1);
    assert.deepEqual(session.messages.filter(message => message.role === 'toolResult').map(message => message.toolName), ['codemode']);
  } finally {
    session.dispose();
  }
});
