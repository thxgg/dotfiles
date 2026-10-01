#!/usr/bin/env node
// One-time migration of project Pi MCP adapter files to native Pi MCP files.
// Pass explicit project roots. Refuse collisions and unsupported adapter settings.
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nativeFields = new Set([
  'command', 'args', 'env', 'cwd', 'url', 'headers', 'type', 'timeout',
  'enabled', 'exposure', 'toolExposure', 'description', 'oauth', 'auth', 'idleTimeout',
]);
const oauthFields = new Set([
  'clientId', 'clientSecret', 'clientName', 'scope', 'callbackPort', 'callbackUrl', 'redirectUri',
]);
export function toNativeMcpServer(name, config) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid MCP server name: ${name}`);
  if ((typeof config.command === 'string') === (typeof config.url === 'string')) {
    throw new Error(`MCP server '${name}' must have exactly one command or URL`);
  }
  if (config.type !== undefined && !['stdio', 'http', 'streamable-http'].includes(config.type)) {
    throw new Error(`MCP server '${name}' uses unsupported transport`);
  }
  const unsupported = Object.keys(config).filter(key => !nativeFields.has(key));
  if (unsupported.length) throw new Error(`MCP server '${name}' uses unsupported fields: ${unsupported.join(', ')}`);
  if (config.auth !== undefined && config.auth !== 'oauth') throw new Error(`MCP server '${name}' uses unsupported adapter authentication`);
  if (config.oauth !== undefined && !isObject(config.oauth)) throw new Error(`MCP server '${name}' has invalid OAuth settings`);
  const oauth = config.oauth;
  const unsupportedOauth = Object.keys(oauth ?? {}).filter(key => !oauthFields.has(key));
  if (unsupportedOauth.length) throw new Error(`MCP server '${name}' uses unsupported OAuth fields: ${unsupportedOauth.join(', ')}`);
  if (oauth?.redirectUri !== undefined && (typeof oauth.redirectUri !== 'string' || oauth.callbackUrl !== undefined)) {
    throw new Error(`MCP server '${name}' has conflicting or invalid OAuth redirect URI`);
  }
  if (config.idleTimeout !== undefined && (typeof config.idleTimeout !== 'number' || config.idleTimeout < 0)) {
    throw new Error(`MCP server '${name}' has invalid idle timeout`);
  }
  const { auth: _auth, idleTimeout: _idleTimeout, ...native } = config;
  if (oauth?.redirectUri !== undefined) {
    const { redirectUri, ...rest } = oauth;
    native.oauth = { ...rest, callbackUrl: redirectUri };
  }
  return native;
}
const readJson = async (path, optional = false) => {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (!isObject(parsed)) throw new Error(`Expected an object: ${path}`);
    return parsed;
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw error;
  }
};

export async function migrateProjects(roots) {
  if (roots.length === 0) throw new Error('Specify at least one project root');
  // Preflight every project before changing any of them.
  const plans = [];
  for (const root of roots) {
    const piDir = join(resolve(root), '.pi');
    const adapterPath = join(piDir, 'mcp-adapter.json');
    const sharedPath = join(resolve(root), '.mcp.json');
    const nativePath = join(piDir, 'mcp.json');
    const manifestPath = join(piDir, 'ephemeral.json');
    const adapter = await readJson(adapterPath, true);
    const shared = await readJson(sharedPath, true);
    if (adapter && shared) throw new Error(`Both adapter and shared MCP configs exist in ${resolve(root)}; merge them manually`);
    if (!adapter && !shared) continue;
    const old = adapter ?? shared;
    const oldPath = adapter ? adapterPath : sharedPath;
    const native = await readJson(nativePath, true) ?? { mcpServers: {} };
    const manifest = await readJson(manifestPath, true);
    if (!isObject(old.mcpServers ?? {}) || !isObject(native.mcpServers ?? {})) {
      throw new Error(`Invalid MCP server map in ${piDir}`);
    }
    if (Object.keys(old).some(key => key !== 'mcpServers' && key !== 'settings') ||
      (old.settings !== undefined && (!isObject(old.settings) ||
        Object.keys(old.settings).some(key => key !== 'loadSharedProjectConfig' || old.settings[key] !== false)))) {
      throw new Error(`Unsupported adapter settings in ${oldPath}`);
    }
    const next = { ...native, mcpServers: { ...native.mcpServers } };
    for (const [name, config] of Object.entries(old.mcpServers ?? {})) {
      if (!isObject(config)) throw new Error(`Invalid MCP server '${name}' in ${oldPath}`);
      const converted = toNativeMcpServer(name, config);
      if (Object.hasOwn(next.mcpServers, name)) {
        if (!adapter && JSON.stringify(next.mcpServers[name]) === JSON.stringify(converted)) continue;
        throw new Error(`MCP server '${name}' already exists in ${nativePath}`);
      }
      next.mcpServers[name] = converted;
    }
    if (manifest && (!isObject(manifest.items) || manifest.version !== 1)) {
      throw new Error(`Invalid Ephemeral manifest: ${manifestPath}`);
    }
    if (!adapter && Object.keys(old.mcpServers ?? {}).every(name => Object.hasOwn(native.mcpServers ?? {}, name))) continue;
    const updatedManifest = manifest && { ...manifest, items: { ...manifest.items } };
    for (const [key, entry] of Object.entries(updatedManifest?.items ?? {})) {
      if (entry.type !== 'mcp') continue;
      if (!Object.hasOwn(next.mcpServers, entry.serverName)) {
        throw new Error(`Managed server '${key}' missing from ${oldPath} and ${nativePath}`);
      }
      if (!Array.isArray(entry.targetPaths) || entry.targetPaths.some(path => path !== oldPath && path !== nativePath)) {
        throw new Error(`Unexpected MCP target for '${key}' in ${manifestPath}`);
      }
      updatedManifest.items[key] = { ...entry, targetPaths: [nativePath] };
    }
    const backup = adapter ? join(piDir, 'mcp-adapter.json.migrated') : undefined;
    if (backup) {
      try { await access(backup); throw new Error(`Migration backup already exists: ${backup}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    plans.push({ piDir, oldPath, nativePath, manifestPath, backup, next, updatedManifest, names: Object.keys(old.mcpServers ?? {}) });
  }
  for (const plan of plans) {
    const nativeTemp = `${plan.nativePath}.migrating-${process.pid}`;
    const manifestTemp = `${plan.manifestPath}.migrating-${process.pid}`;
    try {
      await mkdir(plan.piDir, { recursive: true });
      await writeFile(nativeTemp, `${JSON.stringify(plan.next, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      if (plan.updatedManifest) {
        await writeFile(manifestTemp, `${JSON.stringify(plan.updatedManifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      }
      await rename(nativeTemp, plan.nativePath);
      if (plan.updatedManifest) await rename(manifestTemp, plan.manifestPath);
      if (plan.backup) await rename(plan.oldPath, plan.backup);
      console.log(`${plan.nativePath}: ${plan.names.length} server(s) migrated; ${plan.backup ? `old config saved as ${plan.backup}` : 'shared config preserved'}`);
    } catch (error) {
      // Leave the original adapter file in place if a write fails.
      await Promise.all([rm(nativeTemp, { force: true }), rm(manifestTemp, { force: true })]);
      throw error;
    }
  }
  // Retire Ephemeral metadata only after every managed MCP is present in native config.
  // Non-MCP resources, such as project skills, remain in place.
  for (const root of roots) {
    const piDir = join(resolve(root), '.pi');
    const manifestPath = join(piDir, 'ephemeral.json');
    const manifest = await readJson(manifestPath, true);
    if (!manifest) continue;
    if (manifest.version !== 1 || !isObject(manifest.items)) throw new Error(`Invalid Ephemeral manifest: ${manifestPath}`);
    const native = await readJson(join(piDir, 'mcp.json'), true);
    for (const [key, entry] of Object.entries(manifest.items)) {
      if (entry.type === 'mcp' && !Object.hasOwn(native?.mcpServers ?? {}, entry.serverName)) {
        throw new Error(`Cannot retire Ephemeral: managed MCP '${key}' is missing from ${join(piDir, 'mcp.json')}`);
      }
    }
    const archived = `${manifestPath}.migrated`;
    try { await access(archived); throw new Error(`Migration backup already exists: ${archived}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(manifestPath, archived);
    console.log(`${manifestPath}: Ephemeral manifest archived; project resources retained`);
  }
  return plans.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateProjects(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
