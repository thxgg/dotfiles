import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import { importBrowserProfile } from '../agent/lib/import-browser-profile.ts';
import extension, { runBrowserProfileImport } from '../agent/extensions/import-browser-profile.ts';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'helium-import-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configHome = join(home, '.config');
  const source = join(configHome, 'net.imput.helium');
  const profile = join(source, 'Profile 2');
  const procRoot = join(home, 'proc');
  const executable = join(home, 'helium');
  await mkdir(profile, { recursive: true });
  await mkdir(procRoot);
  await writeFile(executable, '', { mode: 0o700 });
  await writeFile(join(source, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 2' } }));
  await writeFile(join(profile, 'Cookies'), 'synthetic-encrypted-cookies');
  await writeFile(join(profile, 'Preferences'), '{}');
  for (const name of ['Local Storage', 'IndexedDB', 'Service Worker', 'Cache', 'Extensions']) {
    await mkdir(join(profile, name));
    await writeFile(join(profile, name, 'fixture'), 'synthetic-state');
  }
  await writeFile(join(profile, 'Login Data'), 'not-for-import');
  await writeFile(join(profile, 'LOCK'), 'not-for-import');
  await mkdir(join(home, '.agent-browser'));
  const configPath = join(home, '.agent-browser/config.json');
  await writeFile(configPath, JSON.stringify({ colorScheme: 'dark', args: '--disable-dev-shm-usage', profile: 'old' }));
  return { home, configHome, source, profile, procRoot, executable, configPath, platform: 'linux' };
}

async function processFixture(f, executable, args = []) {
  const root = join(f.procRoot, '123');
  await mkdir(root);
  await symlink(executable, join(root, 'exe'));
  await writeFile(join(root, 'comm'), executable.split('/').at(-1));
  await writeFile(join(root, 'cmdline'), [executable, ...args, ''].join('\0'));
}

test('copies session state, selects the correct profile and preserves other settings', async (t) => {
  const f = await fixture(t);
  const original = await readFile(join(f.source, 'Local State'), 'utf8');
  const result = await importBrowserProfile(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  const config = JSON.parse(await readFile(f.configPath, 'utf8'));
  assert.equal(config.profile, result.profile);
  assert.equal(config.executablePath, f.executable);
  assert.equal(config.colorScheme, 'dark');
  assert.equal(config.args, '--disable-dev-shm-usage,--password-store=gnome-libsecret,--profile-directory=Profile 2');
  for (const path of ['Cookies', 'Preferences', 'Local Storage/fixture', 'IndexedDB/fixture', 'Service Worker/fixture']) {
    assert.deepEqual(await readFile(join(result.profile, 'Profile 2', path)), await readFile(join(f.profile, path)));
  }
  for (const path of ['Cache', 'Extensions', 'Login Data', 'LOCK']) {
    await assert.rejects(stat(join(result.profile, 'Profile 2', path)), { code: 'ENOENT' });
  }
  assert.equal((await stat(result.profile)).mode & 0o777, 0o700);
  assert.equal((await stat(join(result.profile, 'Profile 2/Cookies'))).mode & 0o777, 0o600);
  assert.equal((await stat(f.configPath)).mode & 0o777, 0o600);
  assert.equal(await readFile(join(f.source, 'Local State'), 'utf8'), original);
});

test('refuses any running Helium instance without changing configuration', async (t) => {
  const f = await fixture(t);
  await processFixture(f, '/opt/helium-browser-bin/helium');
  const original = await readFile(f.configPath, 'utf8');
  const result = await importBrowserProfile(f);
  assert.equal(result.ok, false);
  assert.match(result.message, /Close all Helium instances/);
  assert.equal(await readFile(f.configPath, 'utf8'), original);
  await assert.rejects(stat(join(f.home, '.agent-browser/helium-imports')), { code: 'ENOENT' });
});

test('refuses a non-Helium browser using an imported profile', async (t) => {
  const f = await fixture(t);
  await processFixture(f, '/opt/chrome/chrome', [`--user-data-dir=${f.home}/.agent-browser/helium-imports/profile-old`]);
  assert.equal((await importBrowserProfile(f)).ok, false);
});

test('ignores unrelated processes that merely mention Helium', async (t) => {
  const f = await fixture(t);
  await processFixture(f, '/usr/bin/bash', ['-c', 'echo helium']);
  assert.equal((await importBrowserProfile(f)).ok, true);
});

test('does not need access to protected executable links of unrelated processes', async (t) => {
  const f = await fixture(t);
  await processFixture(f, '/usr/lib/systemd/systemd', ['--user']);
  await rm(join(f.procRoot, '123/exe'));
  await mkdir(join(f.procRoot, '123/exe'));
  assert.equal((await importBrowserProfile(f)).ok, true);
});

test('detects Helium by process name even when argv differs and exe is unavailable', async (t) => {
  const f = await fixture(t);
  await processFixture(f, '/some/launcher');
  await writeFile(join(f.procRoot, '123/comm'), 'helium');
  await rm(join(f.procRoot, '123/exe'));
  const result = await importBrowserProfile(f);
  assert.equal(result.ok, false);
  assert.match(result.message, /Close all Helium/);
});

test('failure messages identify the failed stage', async (t) => {
  const f = await fixture(t);
  await rm(f.executable);
  const result = await importBrowserProfile(f);
  assert.equal(result.ok, false);
  assert.match(result.message, /checking the Helium executable.*ENOENT/);
});

test('failure leaves the old config and removes partial private copies', async (t) => {
  const f = await fixture(t);
  await symlink('/outside/profile', join(f.profile, 'unexpected-link'));
  const original = await readFile(f.configPath, 'utf8');
  const result = await importBrowserProfile(f);
  assert.equal(result.ok, false);
  assert.equal(await readFile(f.configPath, 'utf8'), original);
  assert.deepEqual(await readdir(join(f.home, '.agent-browser/helium-imports')), []);
});

test('repeat import creates a fresh copy without destroying the previous one', async (t) => {
  const f = await fixture(t);
  const first = await importBrowserProfile(f);
  await writeFile(join(f.profile, 'Cookies'), 'updated-synthetic-cookies');
  const second = await importBrowserProfile(f);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.profile, second.profile);
  assert.equal(await readFile(join(first.profile, 'Profile 2/Cookies'), 'utf8'), 'synthetic-encrypted-cookies');
  assert.equal(await readFile(join(second.profile, 'Profile 2/Cookies'), 'utf8'), 'updated-synthetic-cookies');
});

test('concurrent imports cannot both update the selected profile', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([importBrowserProfile(f), importBrowserProfile(f)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.match(results.find((result) => !result.ok).message, /Another import/);
});

test('rejects invalid profile names before reading outside the source root', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, 'Local State'), JSON.stringify({ profile: { last_used: '../outside' } }));
  const result = await importBrowserProfile(f);
  assert.equal(result.ok, false);
  assert.match(result.message, /last-used profile/);
});

test('rejects invalid or symlinked config without replacing it', async (t) => {
  const f = await fixture(t);
  await writeFile(f.configPath, 'not-json');
  assert.equal((await importBrowserProfile(f)).ok, false);
  assert.equal(await readFile(f.configPath, 'utf8'), 'not-json');
  await rm(f.configPath);
  const outside = join(f.home, 'outside.json');
  await writeFile(outside, '{}');
  await symlink(outside, f.configPath);
  const result = await importBrowserProfile(f);
  assert.equal(result.ok, false);
  assert.match(result.message, /symbolic link/);
  assert.equal(await readFile(outside, 'utf8'), '{}');
});

test('reports unsupported platforms and missing cookie databases', async (t) => {
  const f = await fixture(t);
  assert.match((await importBrowserProfile({ ...f, platform: 'darwin' })).message, /Linux only/);
  await rm(join(f.profile, 'Cookies'));
  assert.match((await importBrowserProfile(f)).message, /no cookie database/);
});

test('refuses connection overrides rather than reporting an unusable default', async (t) => {
  const f = await fixture(t);
  const original = JSON.stringify({ autoConnect: true });
  await writeFile(f.configPath, original);
  const result = await importBrowserProfile(f);
  assert.equal(result.ok, false);
  assert.match(result.message, /conflict/);
  assert.equal(await readFile(f.configPath, 'utf8'), original);
});

test('loads the command through the real Pi CLI without model requests', async (t) => {
  const f = await fixture(t);
  const probe = join(f.home, 'probe.js');
  await writeFile(probe, `export default function(pi) {
    pi.registerCommand('probe', {description: 'Offline probe', handler: async () => {
      if (!pi.getCommands().some(command => command.name === 'import-browser-profile')) throw new Error('Missing command');
      console.log('BROWSER_IMPORT_LOADED');
    }});
  }`);
  const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
  const entry = fileURLToPath(new URL('../agent/extensions/import-browser-profile.ts', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '-ne', '-e', entry, '-e', probe,
    '-ns', '-np', '-nc', '--no-session', '--no-approve', '--offline', '--no-tools', '-p', '/probe'], {
    cwd: f.home, env: { ...process.env, PI_CODING_AGENT_DIR: f.home, PI_OFFLINE: '1' }, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /BROWSER_IMPORT_LOADED/);
  assert.doesNotMatch(result.stdout + result.stderr, /Failed to load extension/);
});

test('shows progress immediately, updates stages, reports success and clears the widget', async (t) => {
  const f = await fixture(t);
  const events = [];
  const pending = runBrowserProfileImport(f, {
    setWidget(key, lines) { events.push({ key, lines }); },
    notify(message, level) { events.push({ message, level }); },
  });
  assert.deepEqual(events[0], { key: 'import-browser-profile', lines: ['Importing Helium profile: starting...'] });
  await pending;
  const stages = events.filter((event) => event.lines).map((event) => event.lines[0]);
  assert.ok(stages.some((stage) => stage.includes('checking running processes')));
  assert.ok(stages.some((stage) => stage.includes('copying the Helium profile')));
  assert.ok(stages.some((stage) => stage.includes('updating Agent Browser configuration')));
  assert.equal(events.at(-2).level, 'info');
  assert.match(events.at(-2).message, /profile imported/);
  assert.deepEqual(events.at(-1), { key: 'import-browser-profile', lines: undefined });
});

test('reports an import error and clears the progress widget', async (t) => {
  const f = await fixture(t);
  await processFixture(f, '/opt/helium-browser-bin/helium');
  const events = [];
  await runBrowserProfileImport(f, {
    setWidget(key, lines) { events.push({ key, lines }); },
    notify(message, level) { events.push({ message, level }); },
  });
  assert.equal(events.at(-2).level, 'error');
  assert.match(events.at(-2).message, /Close all Helium/);
  assert.deepEqual(events.at(-1), { key: 'import-browser-profile', lines: undefined });
});

test('clears the widget even after an unexpected callback failure', async (t) => {
  const f = await fixture(t);
  const events = [];
  await runBrowserProfileImport(f, {
    setWidget(key, lines) {
      events.push({ key, lines });
      if (lines) throw new Error('Synthetic UI failure');
    },
    notify(message, level) { events.push({ message, level }); },
  });
  assert.equal(events.at(-2).level, 'error');
  assert.match(events.at(-2).message, /unexpectedly/);
  assert.deepEqual(events.at(-1), { key: 'import-browser-profile', lines: undefined });
});

test('registration has no I/O and exposes one manual command', () => {
  const commands = [];
  extension({ registerCommand: (name, spec) => commands.push({ name, spec }) });
  assert.deepEqual(commands.map((c) => c.name), ['import-browser-profile']);
  assert.equal(typeof commands[0].spec.handler, 'function');
});
