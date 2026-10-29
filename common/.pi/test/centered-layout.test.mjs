import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { AssistantMessageComponent, getMarkdownTheme, initTheme } from '@earendil-works/pi-coding-agent';
import { Container, ScrollView, Text, visibleWidth } from '@earendil-works/pi-tui';
import { createMermaidMarkdownTransformer } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/mermaid.js';

const agentDir = mkdtempSync(join(tmpdir(), 'pi-centered-test-'));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_CENTERED_WIDTH = '110';
// Use the same dependency lookup as a real Pi launch, not the Node test runner.
process.argv[1] = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
const { default: extension } = await import('../agent/extensions/pi-centered.ts');
initTheme('dark', false);
after(() => rmSync(agentDir, { recursive: true, force: true }));

const short = 'flowchart LR\n A["Browser clients"] --> B["Edge routing"] --> C["API gateway"] --> D["Authorization"] --> E["Order service"] --> F["Event queue"] --> G["Email worker"]';
const huge = 'flowchart LR\n' + Array.from({ length: 15 }, (_, i) => `N${i}["Long pipeline stage ${i}"] --> N${i + 1}["Long pipeline stage ${i + 1}"]`).join('\n');
const small = 'flowchart LR\n A["One"] --> B["Two"]';
const fence = (src) => '```mermaid\n' + src + '\n```';
const message = (text) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' });
const plain = (lines) => lines.map(stripVTControlCharacters);
const firstInk = (line) => line.search(/\S/);

async function harness({ text = `Before paragraph\n\n${fence(short)}\n\nAfter paragraph`, mode = 'streaming', streaming = false, padding = 1 } = {}) {
  let currentMode = mode;
  const component = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), undefined, padding,
    [createMermaidMarkdownTransformer({ getMode: () => currentMode })]);
  component.updateContent(message(text), streaming);
  const root = new Container();
  root.addChild(component);
  const editor = new Text('Editor marker', 0, 0);
  root.addChild(editor);
  const tui = { children: [root], requestRender() {} };
  const notices = [];
  const ctx = { mode: 'tui', ui: {
    notify: (...args) => notices.push(args),
    setWidget: (_key, factory) => { if (factory) factory(tui); },
  } };
  const handlers = new Map();
  const commands = new Map();
  const api = { on: (name, fn) => handlers.set(name, fn), registerCommand: (name, command) => commands.set(name, command) };
  await extension(api);
  await handlers.get('session_start')({}, ctx);
  assert.deepEqual(notices, [], 'Pi Mermaid dependency must resolve');
  return {
    root, component, ctx, handlers, commands, api,
    render: (width) => plain(root.render(width)),
    mode: (value) => { currentMode = value; root.invalidate(); },
    stop: () => handlers.get('session_shutdown')(),
  };
}

function assertColumn(lines, width, padding = 1) {
  for (const marker of ['Before paragraph', 'After paragraph']) {
    const line = lines.find((line) => line.includes(marker));
    assert.ok(line, marker);
    assert.equal(firstInk(line), Math.floor((width - Math.min(width, 110)) / 2) + padding, marker);
  }
}

function assertCenteredArt(lines, width) {
  const borders = lines.filter((line) => line.includes('┌'));
  assert.ok(borders.length, 'diagram should render');
  for (const line of borders) {
    const left = firstInk(line);
    const right = width - visibleWidth(line.trimEnd());
    assert.ok(Math.abs(left - right) <= 1, `art not centered: left=${left}, right=${right}`);
  }
}

test('fitting Mermaid ignores maxwidth and centers independently from prose and editor', async () => {
  const h = await harness();
  try {
    for (const width of [240, 180, 141, 240]) {
      const lines = h.render(width);
      assertColumn(lines, width);
      assertCenteredArt(lines, width);
      assert.ok(!lines.some((line) => line.includes('flowchart LR')));
      assert.equal(firstInk(lines.find((line) => line.includes('Editor marker'))), Math.floor((width - 110) / 2));
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
    }
  } finally { await h.stop(); }
});

test('resize below exact art-plus-padding budget falls back inside the normal column', async () => {
  const h = await harness();
  try {
    assertCenteredArt(h.render(141), 141);
    for (const width of [140, 100, 80]) {
      const lines = h.render(width);
      assertColumn(lines, width);
      assert.ok(!lines.some((line) => line.includes('┌')));
      const left = Math.floor((width - Math.min(width, 110)) / 2);
      assert.ok(lines.filter((line) => line.trim()).every((line) => firstInk(line) >= left));
      assert.ok(lines.every((line) => visibleWidth(line.trimEnd()) <= left + Math.min(width, 110)));
      assert.ok(lines.some((line) => line.includes('flowchart LR')));
    }
    assertCenteredArt(h.render(240), 240);
  } finally { await h.stop(); }
});

test('oversized source remains confined while a fitting neighbor still breaks out', async () => {
  const h = await harness({ text: `Before paragraph\n\n${fence(huge)}\n\n${fence(short)}\n\nAfter paragraph` });
  try {
    const lines = h.render(240);
    assertColumn(lines, 240);
    assertCenteredArt(lines, 240);
    for (const line of lines.filter((line) => line.includes('pipeline') || line.includes('flowchart'))) {
      assert.ok(firstInk(line) >= 65);
      assert.ok(visibleWidth(line.trimEnd()) <= 175);
    }
  } finally { await h.stop(); }
});

test('small diagrams also center independently, including narrow terminals', async () => {
  const h = await harness({ text: `Before paragraph\n\n${fence(small)}\n\nAfter paragraph` });
  try {
    for (const width of [240, 80]) {
      assertCenteredArt(h.render(width), width);
      assertColumn(h.render(width), width);
    }
  } finally { await h.stop(); }
});

test('Mermaid mode and final-only streaming keep native source fallback', async () => {
  for (const options of [{ mode: 'off' }, { mode: 'final', streaming: true }]) {
    const h = await harness(options);
    try {
      assert.ok(h.render(240).some((line) => line.includes('flowchart LR')));
      assertColumn(h.render(240), 240);
      h.mode('streaming');
      assertCenteredArt(h.render(240), 240);
    } finally { await h.stop(); }
  }
});

test('fullscreen scroll view reserves its scrollbar before the fit decision', async () => {
  const h = await harness();
  try {
    const scroll = new ScrollView(h.root, { scrollbar: 'always' });
    assertCenteredArt(plain(scroll.render(142)), 141);
    const fallback = plain(scroll.render(141));
    assert.ok(fallback.some((line) => line.includes('flowchart LR')));
    assert.ok(!fallback.some((line) => line.includes('┌')));
    assertColumn(fallback, 140);
  } finally { await h.stop(); }
});

test('padding zero uses the full art width without reserving phantom cells', async () => {
  const h = await harness({ padding: 0 });
  try { assertCenteredArt(h.render(139), 139); } finally { await h.stop(); }
});

test('real Pi CLI loads the local entry through a leaf symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-centered-cli-'));
  try {
    const entry = join(dir, 'pi-centered.ts');
    symlinkSync(fileURLToPath(new URL('../agent/extensions/pi-centered.ts', import.meta.url)), entry);
    const probe = join(dir, 'probe.js');
    writeFileSync(probe, 'export default function(pi) { pi.registerCommand("probe", {description:"Offline probe", handler:async()=>{console.log("CENTERED_LOAD_OK")}}); }');
    const result = spawnSync(process.execPath, [process.argv[1], '-ne', '-e', entry, '-e', probe,
      '-ns', '-np', '-nc', '--no-session', '--no-approve', '--offline', '--no-tools', '-p', '/probe'], {
      cwd: dir, env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: dir }, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /CENTERED_LOAD_OK/);
    assert.doesNotMatch(result.stdout + result.stderr, /Failed to load extension|Extension error/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reload does not stack padding, and off restores native layout', async () => {
  const h = await harness();
  try {
    const before = h.render(240);
    await h.stop();
    await extension(h.api);
    await h.handlers.get('session_start')({}, h.ctx);
    assert.deepEqual(h.render(240), before);
    await h.commands.get('maxwidth').handler('off', h.ctx);
    assert.equal(firstInk(h.render(240).find((line) => line.includes('Before paragraph'))), 1);
    assert.equal(JSON.parse(readFileSync(join(agentDir, 'pi-centered.json'), 'utf8')).maxWidth, 0);
    await h.commands.get('maxwidth').handler('110', h.ctx);
    assert.deepEqual(h.render(240), before);
    await h.stop();
    assert.equal(firstInk(h.render(240).find((line) => line.includes('Before paragraph'))), 1);
  } finally { await h.stop(); }
});
