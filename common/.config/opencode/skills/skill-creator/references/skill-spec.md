# OpenCode Skill Frontmatter Specification

Every SKILL.md must begin with YAML frontmatter.

## Required Format

```yaml
---
name: skill-name
description: What this skill does and when to use it.
---
```

**Critical:** Frontmatter must start at line 1. No blank lines before `---`.

## Required Fields

### name

| Constraint | Value |
|------------|-------|
| Required | Yes |
| Max length | 64 characters |
| Pattern | `^[a-z0-9]+(-[a-z0-9]+)*$` |
| Must match | Directory name |

Rules: lowercase letters, numbers, hyphens only. Cannot start/end with hyphen. No consecutive hyphens (`--`).

| Style | Example | When to Use |
|-------|---------|-------------|
| Gerund (recommended) | `processing-pdfs` | Actions/capabilities |
| Noun phrase | `pdf-processor` | Tool/utility |
| Domain-specific | `cloudflare` | Platform skills |

### description

| Constraint | Value |
|------------|-------|
| Required | Yes |
| Length | 1-1024 characters |
| Min recommended | 50 characters |

Rules: third person ("Processes files" not "I process files"), include WHAT + WHEN, be specific.

**Good:** `Extract text from PDFs. Use when working with PDF files.`
**Bad:** `Helps with files` (vague), `I help with PDFs` (first person), `PDF tool` (no trigger)

## Optional Fields

### license

```yaml
license: Apache-2.0
```

### compatibility

```yaml
compatibility: Requires git, docker, and jq. macOS/Linux only.
```

Max 500 characters. Document environment requirements.

### metadata

```yaml
metadata:
  author: username
  version: "1.0"
```

String-to-string map. Arbitrary key-value pairs.

**Note:** Unknown frontmatter fields are silently ignored. Only the fields above are recognized. `allowed-tools` and `hooks` are NOT OpenCode features.

## String Substitutions

| Variable | Replaced With |
|----------|---------------|
| `$SKILL_DIR` | Absolute path to the skill's directory |
| `$ARGUMENTS` | Arguments passed when invoking the skill |

## Skill Discovery

### Locations (priority order)

| Priority | Location |
|----------|----------|
| 1 | `.opencode/skills/<name>/SKILL.md` (project) |
| 2 | `~/.config/opencode/skills/<name>/SKILL.md` (global) |

For project-local paths, OpenCode walks up from CWD to git worktree root. First-wins for duplicate names.

### How Agents See Skills

Agents see skill names + descriptions at startup via the `skill` tool description. The full SKILL.md body is loaded on-demand when the agent calls `skill({ name: "skill-name" })`.

## Permissions

Control skill access in `opencode.json`:

```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "internal-*": "deny",
      "experimental-*": "ask"
    }
  }
}
```

| Permission | Behavior |
|------------|----------|
| `allow` | Loads immediately |
| `deny` | Hidden from agent |
| `ask` | User prompted before loading |

### Per-Agent Overrides

Custom agents (in agent frontmatter):
```yaml
---
permission:
  skill:
    "documents-*": "allow"
---
```

Built-in agents (in `opencode.json`):
```json
{ "agent": { "plan": { "permission": { "skill": { "internal-*": "allow" } } } } }
```

### Disabling Skills

Custom agents: add `tools: { skill: false }` to frontmatter.
Built-in agents: add `"tools": { "skill": false }` under the agent config in `opencode.json`.

## Validation Checklist

| Check | Requirement |
|-------|-------------|
| Starts with `---` | Line 1, no preceding blank lines |
| Has `name:` | Required, matches directory name |
| Name format | Lowercase, hyphens, no `--`, no leading/trailing `-` |
| Has `description:` | Required, 1-1024 chars |
| Description quality | 50+ chars, third person, includes triggers |
| Closes with `---` | Required |
| No XML tags | `<purpose>`, `<refs>` invalid in frontmatter |
| No unsupported fields | `allowed-tools`, `hooks` not recognized |
