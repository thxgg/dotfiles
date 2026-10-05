import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';

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

const { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, ToolExecutionComponent, initTheme } = await import('@earendil-works/pi-coding-agent');
const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai/providers/faux');
const { default: gitGuard } = await import('../agent/extensions/git-interceptor.ts');
const { default: cloak } = await import('../agent/extensions/pi-cloak/index.ts');
const { default: verbosity } = await import('../agent/extensions/verbosity-level/index.ts');
const { default: sanitizeAnthropic } = await import('../agent/extensions/anthropic-prompt-sanitizer.ts');

test('Anthropic request sanitation preserves the canonical session and tool declarations', async () => {
  const settingsManager = SettingsManager.inMemory({ defaultTools: ['+codemode'], cacheWarming: 'off', retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [createCodemodeExtension({ mode: 'on' }), sanitizeAnthropic],
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
    const codemode = request.messages[0].toolsAdded.find(tool => tool.name === 'codemode');
    assert.ok(codemode, 'keep codemode available after sanitation');
    assert.match(codemode.description, /codemode\.md/, 'preserve the native models API documentation path');
    assert.match(JSON.stringify(session.sessionManager.getBranch()), /Pi documentation/);
  } finally {
    session.dispose();
  }
});

test('native codemode preserves guards and execution with renderer-only verbosity, including HTML export', async () => {
  initTheme('dark', false);
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
    model: faux.getModel(), sessionManager: SessionManager.create(cwd, join(root, 'sessions')),
  });
  const events = [];
  session.subscribe(event => events.push(event));
  try {
    await session.bindExtensions({ mode: 'tui' });
    const rows = new Map();
    session.subscribe(event => {
      if (event.type === 'tool_execution_start' && !event.parentToolCallId) {
        const renderers = session.extensionRunner.resolveToolRenderers(event.toolName, () => session.getToolDefinition(event.toolName));
        rows.set(event.toolCallId, new ToolExecutionComponent(event.toolName, event.toolCallId, event.args, { showImages: false }, renderers, { requestRender() {} }, cwd));
      } else if ((event.type === 'tool_execution_update' || event.type === 'tool_execution_end') && !event.parentToolCallId) {
        const result = event.type === 'tool_execution_update' ? event.partialResult : event.result;
        rows.get(event.toolCallId)?.updateResult({ ...result, isError: event.isError ?? false }, event.type === 'tool_execution_update');
      }
    });
    assert.deepEqual(resourceLoader.getExtensions().extensions.flatMap(extension => [...extension.tools.keys()]), ['codemode']);
    for (const name of ['read', 'bash', 'edit', 'write', 'codemode']) assert.ok(session.getActiveToolNames().includes(name), name);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('codemode', { code: `
        const masked = await tools.read({ path: '.env' });
        let blocked;
        try { await tools.bash({ command: 'git status --no-verify' }); }
        catch (error) { blocked = error.message; }
        const shell = await tools.bash({ command: "# git editor check\\nprintf '%s/%s/%s' \\"$GIT_EDITOR\\" \\"$GIT_SEQUENCE_EDITOR\\" \\"$GIT_MERGE_AUTOEDIT\\"" });
        const hasRead = 'read' in tools;
        const hasMissing = 'missing_fixture_tool' in tools;
        let missingError;
        try { tools.Bash; } catch (error) { missingError = error.message; }
        return { masked, blocked, shell, hasRead, hasMissing, missingError };
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
    assert.match(text, /"hasRead":\s*true/);
    assert.match(text, /"hasMissing":\s*false/);
    assert.match(text, /tools\.bash/, 'missing-member errors suggest the correct tool');
    const nested = events.filter(event => event.type === 'tool_execution_end' && event.parentToolCallId === 'batch');
    assert.equal(nested.length, 3);
    assert.equal(nested.filter(event => event.isError).length, 1);
    assert.deepEqual(session.messages.filter(message => message.role === 'toolResult').map(message => message.toolName), ['codemode']);
    const row = rows.get('batch');
    assert.ok(row);
    const rendered = () => stripVTControlCharacters(row.render(120).join('\n'));
    assert.match(rendered(), /Codemode · Activity 1 read, 2 commands · 1 FAILED/);
    assert.doesNotMatch(rendered(), /const masked/);
    row.setExpanded(true);
    assert.match(rendered(), /const masked/);
    assert.match(rendered(), /BLOCKED: --no-verify/);
    await session.prompt('/verbosity default');
    assert.doesNotMatch(rendered(), /Codemode · Activity/);
    await session.prompt('/verbosity low');
    // HTML renders call and result separately, unlike the combined TUI slots.
    const exported = await session.exportToHtml(join(root, 'codemode.html'));
    const html = readFileSync(exported, 'utf8');
    const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
    assert.ok(encoded);
    const exportedData = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    assert.match(exportedData.renderedTools.batch.resultHtmlExpanded, /BLOCKED/);
    assert.match(exportedData.renderedTools.batch.callHtml, /Codemode/);
    row.setExpanded(false);
    assert.match(rendered(), /Codemode · Activity/);
    await session.prompt('/verbosity default');
    assert.doesNotMatch(rendered(), /Codemode · Activity/, 'HTML export must not replace the live row invalidator');
  } finally {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
    session.dispose();
  }
});
