# OpenCode Config

## Purpose & Scope
Defines local OpenCode behavior: agents, commands, skills, themes, and plugin code.
This subtree acts like a small config+code workspace under dotfiles.

## Entry Points & Contracts
- Runtime config: `opencode.jsonc` (model defaults, agent modes, MCP servers, plugins).
- Agent definitions: `agents/*.md`.
- Command shims: `commands/*.md` (mostly skill delegation).
- Skill implementations: `skills/<name>/SKILL.md` (+ optional `references/` + scripts).
- Local plugin code: `plugins/*.ts` and `preemptive-compaction.ts`.

## Usage Patterns
- Add a capability by creating/updating a skill, then wire command docs if discoverability is needed.
- Keep machine secrets as env vars and reference them in `opencode.jsonc`.
- Use Bun for local package management (`package.json`, `bun.lock`).

## Anti-Patterns
- Hardcoding API keys in `opencode.jsonc`; prefer `{env:VAR}` references.
- Letting `commands/` and `skills/` drift (skill exists but no corresponding command entry when expected).
- Committing `node_modules/` or generated build artifacts.

## Dependencies & Edges
- Uplink: [Config Tree](../CLAUDE.md)
- Downlinks: none

## Patterns & Pitfalls
- Some skills are intentionally large; keep edits surgical and avoid broad rewrites.
- Plugin registration must match what `opencode.jsonc` actually loads.
- Validate skill changes with script tooling in `skills/skill-creator/scripts/` when applicable.
