import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentSource = "builtin" | "user" | "project";
export type AgentScope = "default" | "builtin" | "user" | "project" | "all";
export type BackgroundPolicy = false | true | "allowed";
export type BashPermission = "allow" | "readonly" | "deny";

export interface AgentPermissions {
  edit?: "allow" | "ask" | "deny";
  write?: "allow" | "ask" | "deny";
  bash?: BashPermission | "ask";
}

export interface AgentCompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  disallowedTools?: string[];
  permissions: AgentPermissions;
  compaction?: AgentCompactionSettings;
  maxTurns?: number;
  background: BackgroundPolicy;
  returnMode?: string;
  outputSchema?: unknown;
  hidden: boolean;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentDefinition[];
  projectAgentsDir: string | null;
  dirs: Partial<Record<AgentSource, string>>;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const thisFile = fileURLToPath(import.meta.url);
const builtinAgentsDir = path.join(path.dirname(thisFile), "agents");

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(normalized)) return true;
    if (["false", "no", "0", "off"].includes(normalized)) return false;
  }
  return defaultValue;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function parseThinking(value: unknown): ThinkingLevel | undefined {
  const candidate = asString(value);
  if (candidate && THINKING_LEVELS.has(candidate)) return candidate as ThinkingLevel;
  return undefined;
}

function parseBackground(value: unknown): BackgroundPolicy {
  if (value === "allowed") return "allowed";
  return asBoolean(value, false);
}

function parsePermissions(value: unknown): AgentPermissions {
  const record = asRecord(value);
  const permissions: AgentPermissions = {};
  if (record.edit === "deny" || record.edit === "ask" || record.edit === "allow") permissions.edit = record.edit;
  if (record.write === "deny" || record.write === "ask" || record.write === "allow") permissions.write = record.write;
  if (record.bash === "readonly" || record.bash === "deny" || record.bash === "ask" || record.bash === "allow") permissions.bash = record.bash;
  return permissions;
}

function parseCompaction(value: unknown): AgentCompactionSettings | undefined {
  const record = asRecord(value);
  const reserveTokens = asNumber(record.reserveTokens);
  const keepRecentTokens = asNumber(record.keepRecentTokens);
  if (reserveTokens === undefined || keepRecentTokens === undefined) return undefined;
  return {
    enabled: asBoolean(record.enabled, true),
    reserveTokens,
    keepRecentTokens,
  };
}

function normalizeAgent(frontmatter: Record<string, unknown>, body: string, source: AgentSource, filePath: string): AgentDefinition | null {
  const name = asString(frontmatter.name);
  const description = asString(frontmatter.description);
  if (!name || !description) return null;

  const maxTurns = asNumber(frontmatter.maxTurns);

  return {
    name,
    description,
    model: asString(frontmatter.model),
    thinking: parseThinking(frontmatter.thinking),
    tools: asStringArray(frontmatter.tools),
    disallowedTools: asStringArray(frontmatter.disallowedTools),
    permissions: parsePermissions(frontmatter.permissions),
    compaction: parseCompaction(frontmatter.compaction),
    maxTurns: maxTurns && maxTurns > 0 ? Math.floor(maxTurns) : undefined,
    background: parseBackground(frontmatter.background),
    returnMode: asString(frontmatter.returnMode),
    outputSchema: frontmatter.outputSchema,
    hidden: asBoolean(frontmatter.hidden, false),
    systemPrompt: body.trim(),
    source,
    filePath,
  };
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentDefinition[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: AgentDefinition[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
      const agent = normalizeAgent(frontmatter, body, source, filePath);
      if (agent) agents.push(agent);
    } catch {
      // Ignore malformed or unreadable agent files. They simply do not load.
    }
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function includeSource(scope: AgentScope, source: AgentSource): boolean {
  if (scope === "all") return true;
  if (scope === "default") return source === "builtin" || source === "user";
  return scope === source;
}

export function discoverAgents(cwd: string, scope: AgentScope = "default"): AgentDiscoveryResult {
  const userAgentsDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const dirs: Partial<Record<AgentSource, string>> = {
    builtin: builtinAgentsDir,
    user: userAgentsDir,
    ...(projectAgentsDir ? { project: projectAgentsDir } : {}),
  };

  const byName = new Map<string, AgentDefinition>();
  const orderedSources: AgentSource[] = ["builtin", "user", "project"];

  for (const source of orderedSources) {
    const dir = dirs[source];
    if (!dir || !includeSource(scope, source)) continue;
    for (const agent of loadAgentsFromDir(dir, source)) {
      byName.set(agent.name, agent);
    }
  }

  return {
    agents: Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)),
    projectAgentsDir,
    dirs,
  };
}

export function getAgentByName(agents: AgentDefinition[], name: string, includeHidden = true): AgentDefinition | undefined {
  return agents.find((agent) => agent.name === name && (includeHidden || !agent.hidden));
}

export function formatAgentList(agents: AgentDefinition[], includeHidden = false): string {
  const visible = includeHidden ? agents : agents.filter((agent) => !agent.hidden);
  if (visible.length === 0) return "No agents found.";
  return visible
    .map((agent) => {
      const hidden = agent.hidden ? " hidden" : "";
      const model = agent.model ? ` model=${agent.model}` : "";
      const thinking = agent.thinking ? ` thinking=${agent.thinking}` : "";
      return `- ${agent.name} (${agent.source}${hidden}): ${agent.description}${model}${thinking}`;
    })
    .join("\n");
}

export function getDisallowedToolNames(agent: AgentDefinition): string[] {
  const disallowed = new Set(agent.disallowedTools ?? []);
  // Nested delegation is deliberately disabled for all child agents.
  disallowed.add("Agent");
  if (agent.permissions.edit === "deny") disallowed.add("edit");
  if (agent.permissions.write === "deny") disallowed.add("write");
  if (agent.permissions.bash === "deny") disallowed.add("bash");
  return Array.from(disallowed).sort();
}

export function getActiveToolNames(agent: AgentDefinition): string[] | undefined {
  if (!agent.tools) return undefined;
  const disallowed = new Set(getDisallowedToolNames(agent));
  return agent.tools.filter((tool) => !disallowed.has(tool));
}
