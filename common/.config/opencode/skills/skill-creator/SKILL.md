---
name: skill-creator
description: Create effective skills for OpenCode agents. Load FIRST before writing any SKILL.md. Provides required format, naming conventions, progressive disclosure patterns, and validation. Use when building, reviewing, or debugging skills.
---

# Building Skills

Skills extend agent capabilities with specialized knowledge, workflows, and tools.

## Quick Start

Minimal viable skill in 30 seconds:

```bash
mkdir my-skill && cat > my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: Does X when Y happens. Use for Z tasks.
---

# My Skill

Instructions go here.
EOF
```

Place in `.opencode/skills/` (project) or `~/.config/opencode/skills/` (global).

## Skill Type Decision Tree

```
What are you building?
|-- Instructions only        -> Simple skill (SKILL.md only)
|   Example: code-review guidelines, commit message format
|
|-- Domain knowledge         -> Reference-heavy skill (+ references/)
|   Example: API docs, database schemas, company policies
|
|-- Repeatable automation    -> Script-heavy skill (+ scripts/)
|   Example: PDF processing, data validation, file conversion
|
|-- Complex multi-step       -> Multi-file skill (all directories)
|   Example: release process, deployment pipeline
|
'-- Large platform           -> Progressive skill
    Example: AWS, GCP, Cloudflare (many products)
```

## When to Create a Skill

Create a skill when:
- Same instructions repeated across conversations
- Domain knowledge model lacks (schemas, internal APIs, company policies)
- Workflow requires 3+ steps with specific order
- Code rewritten repeatedly for same task
- Team needs shared procedural knowledge

## When NOT to Create a Skill

| Scenario | Do Instead |
|----------|------------|
| Single-use instructions | AGENTS.md or inline in conversation |
| Model already knows domain | Don't add redundant context |
| < 3 steps, no reuse | Inline instructions |
| Highly variable workflow | Higher-freedom guidelines |
| Just want to store files | Use regular directories |

## Frontmatter Quick Reference

```yaml
---
name: my-skill                # Required. Lowercase, hyphens, no spaces.
description: What + when.     # Required. 1-1024 chars.
license: MIT                  # Optional.
compatibility: Requires git   # Optional. Max 500 chars.
metadata:                     # Optional. String-to-string map.
  author: username
  version: "1.0"
---
```

Only these fields are recognized. Unknown fields are silently ignored.

## Reading Order

| Task | Files to Read |
|------|---------------|
| New skill from scratch | anatomy.md -> frontmatter.md |
| Optimize existing skill | best-practices.md (progressive disclosure) |
| Add scripts/resources | anatomy.md (bundled resources section) |
| Find skill pattern | patterns.md |
| Debug/fix skill | gotchas.md |

## In This Reference

| File | Purpose |
|------|---------|
| [anatomy.md]($SKILL_DIR/references/anatomy.md) | Skill directory structures and file sizing |
| [skill-spec.md]($SKILL_DIR/references/skill-spec.md) | YAML spec, naming, validation, permissions |
| [best-practices.md]($SKILL_DIR/references/best-practices.md) | Progressive disclosure and token-efficient design |
| [patterns.md]($SKILL_DIR/references/patterns.md) | Real-world skill patterns |
| [gotchas.md]($SKILL_DIR/references/gotchas.md) | Common mistakes and fixes |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init-skill.sh` | Scaffold new skill with type-appropriate structure |
| `scripts/validate-skill.sh` | Validate skill structure and frontmatter |
| `scripts/package-skill.sh` | Create distributable zip |

### Scaffolding a New Skill

```bash
bash $SKILL_DIR/scripts/init-skill.sh <skill-name> <output-dir> [--type TYPE]

# Types: minimal, standard (default), reference-heavy, script-heavy
# Example:
bash $SKILL_DIR/scripts/init-skill.sh my-skill ~/.config/opencode/skills --type standard
```

### Validating a Skill

```bash
bash $SKILL_DIR/scripts/validate-skill.sh ./my-skill
bash $SKILL_DIR/scripts/validate-skill.sh ./my-skill --json
```

## Pre-Flight Checklist

Before using a skill:

- [ ] SKILL.md starts with `---` (line 1, no blank lines)
- [ ] `name:` field present, matches directory name
- [ ] `description:` includes what + when to use (1-1024 chars)
- [ ] Closing `---` after frontmatter
- [ ] SKILL.md under 200 lines (use references/ for more)
- [ ] All internal links resolve
- [ ] Name is unique across all skill locations

Run: `bash $SKILL_DIR/scripts/validate-skill.sh ./my-skill`

## Skill Locations

| Priority | Location |
|----------|----------|
| 1 | `.opencode/skills/<name>/` (project) |
| 2 | `~/.config/opencode/skills/<name>/` (global) |
| 3 | `.claude/skills/<name>/` (Claude-compat, project) |
| 4 | `~/.claude/skills/<name>/` (Claude-compat, global) |

Discovery walks up from CWD to git root for project-local paths.
