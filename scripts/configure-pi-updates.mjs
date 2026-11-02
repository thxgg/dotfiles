#!/usr/bin/env node
// Explicit, machine-local opt-in. Never runs an updater or replaces other preferences.
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const directory = resolve(process.argv[2] ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent'));
const path = join(directory, 'settings.json');
let temporary;
try {
  let original;
  let mode = 0o600;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error('settings.json must be a regular machine-local file');
    mode = stat.mode & 0o777;
    original = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const settings = original === undefined ? {} : JSON.parse(original);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings.json must contain an object');
  settings.selfUpdateCommand = ['vp', 'install', '--global', '{installSpec}'];
  // Show native Pi and extension-package release notes in full on fresh launches.
  settings.collapseChangelog = false;
  const updated = JSON.stringify(settings, null, 2) + '\n';
  if (updated !== original) {
    mkdirSync(directory, { recursive: true });
    temporary = join(directory, `.settings-${randomUUID()}.tmp`);
    writeFileSync(temporary, updated, { mode, flag: 'wx' });
    renameSync(temporary, path);
    temporary = undefined;
  }
  console.log('Configured Vite+ self-updates and full native changelog notices. No update was run.');
} catch (error) {
  console.error(`Cannot configure Pi updates: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (temporary) unlinkSync(temporary);
}
