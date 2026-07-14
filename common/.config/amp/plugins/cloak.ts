// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now

import type { PluginAPI } from "@ampcode/plugin"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

interface CloakPatternObject {
  pattern: string
  replace?: string
  flags?: string
}

type CloakPatternSpec = string | CloakPatternObject

interface CloakRuleConfig {
  filePattern: string | string[]
  cloakPattern: CloakPatternSpec | CloakPatternSpec[]
  replace?: string
}

interface CloakConfig {
  enabled?: boolean
  cloakCharacter?: string
  cloakLength?: number | null
  tryAllPatterns?: boolean
  patterns?: CloakRuleConfig[]
}

interface CompiledPattern {
  regex: RegExp
  replace?: string
}

interface CompiledRule {
  fileRegexes: RegExp[]
  patterns: CompiledPattern[]
}

interface RuntimeState {
  config: CloakConfig
  rules: CompiledRule[]
  error?: string
}

const configPath = join(dirname(import.meta.path), "..", "cloak.json")
const defaultConfig: CloakConfig = {
  enabled: true,
  cloakCharacter: "*",
  cloakLength: null,
  tryAllPatterns: true,
  patterns: [],
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function expandHome(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return join(homedir(), value.slice(2))
  return value
}

function normalizePath(value: string): string {
  return expandHome(value.trim()).replaceAll("\\", "/")
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob)
  let pattern = "^"

  for (let index = 0; index < normalized.length; index++) {
    const character = normalized[index]!
    const next = normalized[index + 1]
    const afterNext = normalized[index + 2]

    if (character === "*" && next === "*") {
      if (afterNext === "/") {
        pattern += "(?:.*/)?"
        index += 2
      } else {
        pattern += ".*"
        index += 1
      }
      continue
    }

    if (character === "*") {
      pattern += "[^/]*"
      continue
    }

    if (character === "?") {
      pattern += "[^/]"
      continue
    }

    pattern += escapeRegex(character)
  }

  return new RegExp(pattern + "$")
}

function globalFlags(flags = ""): string {
  return [...new Set([...flags, "g"])].join("")
}

function compilePattern(spec: CloakPatternSpec, fallback?: string): CompiledPattern {
  if (typeof spec === "string") {
    return { regex: new RegExp(spec, "g"), replace: fallback }
  }
  return {
    regex: new RegExp(spec.pattern, globalFlags(spec.flags)),
    replace: spec.replace ?? fallback,
  }
}

function loadState(): RuntimeState {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as CloakConfig
    const config = { ...defaultConfig, ...parsed, patterns: parsed.patterns ?? [] }
    const rules = (config.patterns ?? []).map((rule) => ({
      fileRegexes: asArray(rule.filePattern).map(globToRegExp),
      patterns: asArray(rule.cloakPattern).map((pattern) =>
        compilePattern(pattern, rule.replace),
      ),
    }))
    return { config, rules }
  } catch (error) {
    return {
      config: defaultConfig,
      rules: [],
      error: `amp-cloak failed to load ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
}

function pathCandidates(rawPath: string, cwd: string): string[] {
  const cleanPath = normalizePath(rawPath.startsWith("@") ? rawPath.slice(1) : rawPath)
  const absolutePath = normalizePath(resolve(cwd, cleanPath))
  return [...new Set([cleanPath, absolutePath, basename(cleanPath), basename(absolutePath)])]
}

function repeatToLength(seed: string, length: number): string {
  if (!seed || length <= 0) return ""
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length)
}

function applyTemplate(template: string, match: string, captures: string[]): string {
  return template.replace(/\$(\$|&|\d{1,2})/g, (_token, reference: string) => {
    if (reference === "$") return "$"
    if (reference === "&") return match
    return captures[Number(reference) - 1] ?? ""
  })
}

function cloakText(text: string, rawPath: string, cwd: string, state: RuntimeState): string {
  if (state.config.enabled === false) return text

  const candidates = pathCandidates(rawPath, cwd)
  const matchingRules = state.rules.filter((rule) =>
    candidates.some((candidate) => rule.fileRegexes.some((regex) => regex.test(candidate))),
  )
  if (matchingRules.length === 0) return text

  let updated = text
  for (const rule of matchingRules) {
    for (const pattern of rule.patterns) {
      let matched = false
      updated = updated.replace(pattern.regex, (match: string, ...args: unknown[]) => {
        matched = true
        const captures = args
          .slice(0, Math.max(0, args.length - 2))
          .map((value) => String(value ?? ""))
        const visible = pattern.replace
          ? applyTemplate(pattern.replace, match, captures)
          : match.slice(0, 1)
        const targetLength = state.config.cloakLength ?? Math.max(match.length, visible.length)
        const prefix = visible.slice(0, targetLength)
        return prefix + repeatToLength(
          state.config.cloakCharacter ?? "*",
          Math.max(0, targetLength - prefix.length),
        )
      })
      if (matched && state.config.tryAllPatterns === false) break
    }
  }
  return updated
}

function cloakOutput(output: unknown, rawPath: string, cwd: string, state: RuntimeState): unknown {
  if (typeof output === "string") return cloakText(output, rawPath, cwd, state)
  if (Array.isArray(output)) {
    return output.map((value) => cloakOutput(value, rawPath, cwd, state))
  }
  if (output && typeof output === "object") {
    return Object.fromEntries(
      Object.entries(output).map(([key, value]) => [
        key,
        key === "data" ? value : cloakOutput(value, rawPath, cwd, state),
      ]),
    )
  }
  return output
}

function workspacePath(amp: PluginAPI): string {
  const root = amp.system.workspaceRoot
  return root ? amp.helpers.filePathFromURI(root) : process.cwd()
}

function commandPathCandidates(command: string): string[] {
  return (command.match(/"[^"]+"|'[^']+'|\S+/g) ?? [])
    .map((token) => token.replace(/^["']|["';|&<>]$/g, ""))
    .filter((token) => token.includes("/") || token.includes("."))
}

function matchingInputPath(
  amp: PluginAPI,
  event: { tool: string; input: Record<string, unknown> },
  cwd: string,
  state: RuntimeState,
): string | undefined {
  const directPath = ["path", "file_path", "filePath"]
    .map((key) => event.input[key])
    .find((value): value is string => typeof value === "string")
  const shellCommand = amp.helpers.shellCommandFromToolCall({
    toolUseID: "cloak-path-discovery",
    tool: event.tool,
    input: event.input,
  })
  const candidates = [
    ...(directPath ? [directPath] : []),
    ...(shellCommand ? commandPathCandidates(shellCommand.command) : []),
  ]

  return candidates.find((candidate) => {
    const paths = pathCandidates(candidate, cwd)
    return state.rules.some((rule) =>
      paths.some((path) => rule.fileRegexes.some((regex) => regex.test(path))),
    )
  })
}

export default function cloak(amp: PluginAPI) {
  let state = loadState()
  if (state.error) amp.logger.log(state.error)

  amp.registerCommand(
    "cloak-status",
    {
      title: "Show cloak status",
      category: "cloak",
      description: "Reload and show the Amp cloak configuration status",
    },
    async (context) => {
      state = loadState()
      await context.ui.notify(
        state.error ??
          `amp-cloak enabled=${state.config.enabled !== false} patterns=${state.rules.length} config=${configPath}`,
      )
    },
  )

  amp.on("tool.result", (event) => {
    if (state.config.enabled === false) return

    const cwd = workspacePath(amp)
    const rawPath = matchingInputPath(amp, event, cwd, state)
    if (!rawPath) return

    const output = cloakOutput(event.output, rawPath, cwd, state)
    return event.status === "error"
      ? { status: "error", output, error: event.error }
      : { status: event.status, output }
  })
}
