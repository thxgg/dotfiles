#!/usr/bin/env node
// Reproducible local patch for pi-extmgr 0.4.2. Never patch Pi's own installation.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const marker = '// dotfiles: lazy pi-extmgr commands v1\n';
const hash = (text) => createHash('sha256').update(text).digest('hex');

// The hash gate makes upgrades an explicit rebase, not a best-effort text rewrite.
const originals = {
  'src/index.ts': '01af09b01df60cdc84757fda14cbdd21d9e4d99d5447508c8dc4d1bd7f77b5ca',
  'src/commands/registry.ts': '7ca85e6158ff5a6f9859facda4a59f0476714a34960bbb8f8fec4606bd5accfd',
};

const patchedHashes = {
  'src/index.ts': '1ca07e7f712526ec3cdec4a3ee322b3d4b065f3f5cb7f5a0ba7ccf68b36b9119',
  'src/commands/registry.ts': '4be2ed88fd7ee538e4b767c43f871c9db74d45aa41620b87081827481f7ea468',
};

/** Transform a reviewed pristine source, or accept its exact patched output. */
export function patchSource(file, source) {
  if (hash(source) === patchedHashes[file]) return source;
  if (hash(source) !== originals[file]) throw new Error(`pi-extmgr patch: unsupported source ${file}`);
  if (file === 'src/index.ts') {
    return marker + source.replace('import { installPackage } from "./packages/install.js";\n', '')
      .replace('await installPackage(args.trim(), ctx, pi);', 'await (await import("./packages/install.js")).installPackage(args.trim(), ctx, pi);');
  }
  const eager = new Set(['../utils/notify.js', './completion.js', './types.js']);
  // This 0.4.2 registry has two metadata constants. Retain their exact values so
  // synchronous completion does not import the command implementations.
  let patched = source.replace(/import \{([\s\S]*?)\} from "([^"]+)";/g, (statement, bindings, module) => {
    if (module.startsWith('@') || eager.has(module)) return statement;
    return bindings.split(',').map((binding) => binding.trim()).filter(Boolean).map((name) => {
      if (name === 'HISTORY_ACTIONS') return 'const HISTORY_ACTIONS = ["extension_toggle", "extension_delete", "package_install", "package_update", "package_remove", "cache_clear", "auto_update_config"] as const;';
      if (name === 'INSTALL_USAGE') return 'const INSTALL_USAGE = "Usage: /extensions install <source> [--project|--global]";';
      if (!/^[A-Za-z]+$/.test(name)) throw new Error(`Unsupported binding ${name}`);
      return `async function ${name}(...args: Parameters<typeof import("${module}").${name}>) {\n  return (await import("${module}")).${name}(...args);\n}`;
    }).join('\n');
  });
  patched = patched.replace('const owners = getRuntimeOwners(pi);', 'const owners = await getRuntimeOwners(pi);')
    .replace('const conflicts = findRuntimeConflicts(owners);', 'const conflicts = await findRuntimeConflicts(owners);');
  return marker + patched;
}

/** Apply the version-gated patch after checking all sources; reject unknown inputs. */
export async function patchPackage(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== 'pi-extmgr' || manifest.version !== '0.4.2') {
    throw new Error('pi-extmgr patch requires version 0.4.2; rebase the patch before upgrading');
  }
  // Validate every file before writing any file. Repeat runs are no-ops.
  const changes = await Promise.all(Object.keys(originals).map(async (file) => {
    const source = await readFile(join(directory, file), 'utf8');
    return { file, source, patched: patchSource(file, source) };
  }));
  for (const { file, source, patched } of changes) {
    if (source !== patched) await writeFile(join(directory, file), patched);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2] ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent'), 'npm/node_modules/pi-extmgr');
  try { await patchPackage(directory); console.log('[OK] pi-extmgr lazy command imports applied'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
