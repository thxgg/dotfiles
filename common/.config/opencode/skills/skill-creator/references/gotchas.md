# Common Mistakes

Issues, causes, and fixes for skill creation.

## Frontmatter Errors

| Error | Fix |
|-------|-----|
| No opening `---` | Must start at line 1 |
| Blank lines before `---` | Frontmatter must be the very first thing |
| No closing `---` | Add `---` after fields |
| XML tags `<description>` | Use YAML only, no XML |
| Using `allowed-tools:` | Not an OpenCode feature (Claude Code only) |
| Using `hooks:` | Not an OpenCode feature |
| Indentation errors | Use 2-space indent for nested YAML |

## Name Field Errors

| Error | Bad | Good |
|-------|-----|------|
| Uppercase | `My-Skill` | `my-skill` |
| Underscores | `my_skill` | `my-skill` |
| Leading hyphen | `-my-skill` | `my-skill` |
| Trailing hyphen | `my-skill-` | `my-skill` |
| Double hyphens | `my--skill` | `my-skill` |
| Dir mismatch | Dir: `foo/`, name: `bar` | Match both |
| Too long | 65+ characters | Max 64 characters |
| Too vague | `helper`, `utils` | `data-validator` |

**Valid pattern:** `^[a-z0-9]+(-[a-z0-9]+)*$`

## Description Errors

| Error | Bad | Good |
|-------|-----|------|
| Too vague | "Helps with files" | "Extract text from PDFs" |
| First person | "I help with PDFs" | "Extracts text from PDFs" |
| No trigger | "PDF tool" | "PDF tool. Use when working with PDFs." |
| Too short | "PDF" | 50+ characters recommended |
| Too long | 1025+ chars | Max 1024 characters |

## Structure Errors

| Error | Fix |
|-------|-----|
| SKILL.md > 500 lines | Split to references/ |
| Duplicated content | Link, don't copy |
| Broken internal links | Verify all paths exist |
| SKILL.md not uppercase | Must be `SKILL.md`, not `skill.md` |
| Wrong directory | Must be `skills/<name>/SKILL.md`, not loose |

## Script Errors

| Error | Fix |
|-------|-----|
| No shebang | Add `#!/usr/bin/env bash` |
| Silent failures | Add `set -euo pipefail` |
| Not executable | Run `chmod +x script.sh` |
| Hardcoded paths | Use `$SKILL_DIR` or relative paths |

## Discovery Issues

| Symptom | Possible Cause |
|---------|---------------|
| Skill not appearing | SKILL.md misspelled (case matters) |
| Skill not appearing | Missing `name:` or `description:` in frontmatter |
| Skill not appearing | Permission set to `deny` in opencode.json |
| Wrong skill loaded | Duplicate names across locations (project wins) |
| Skill loads but empty | Frontmatter not closed with `---` |

## Context Rot Symptoms

| Symptom | Fix |
|---------|-----|
| Agent ignores instructions | Reduce SKILL.md size, under 200 lines |
| Wrong file accessed | Add decision trees and reading order tables |
| Repeated questions | Improve cross-references between files |
| Slow responses | Split monolithic files into multi-file structure |
| Agent loads everything | Add navigation to guide selective loading |

## Permissions Issues

| Symptom | Fix |
|---------|-----|
| Skill hidden from agent | Check `permission.skill` in opencode.json |
| Prompted every time | Change pattern from `ask` to `allow` |
| Agent can't use skill tool | Check if `tools.skill: false` is set for the agent |
