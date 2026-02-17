# Skill Anatomy

Skill directory structures from minimal to complex.

## Directory Patterns

### Minimal Skill (SKILL.md Only)

```
my-skill/
'-- SKILL.md
```

**When to use:**
- Instructions fit in <200 lines
- No external resources needed
- Simple procedural guidance

**Example:** Code review guidelines, commit message format, naming conventions.

### Simple Skill with Scripts

```
my-skill/
|-- SKILL.md
'-- scripts/
    '-- validate.sh
```

**When to use:**
- Repeatable automation tasks
- Deterministic operations (validation, conversion)
- Code that would be rewritten each time

**Example:** PDF processing, data validation, file format conversion.

### Reference-Heavy Skill

```
my-skill/
|-- SKILL.md
'-- references/
    |-- api.md
    |-- schemas.md
    '-- examples.md
```

**When to use:**
- Domain knowledge model lacks
- Detailed specs/schemas needed
- Content too large for single file

**Example:** Internal API docs, database schemas, company policies.

### Complex Multi-File Skill

```
my-skill/
|-- SKILL.md
|-- references/
|   |-- workflow.md
|   '-- troubleshooting.md
|-- scripts/
|   '-- deploy.sh
'-- assets/
    '-- template.yaml
```

**When to use:**
- Multi-step workflows
- Mix of documentation + automation
- Templates/boilerplate needed

**Example:** Release process, deployment pipeline, project scaffolding.

### Progressive Skill

```
my-platform/
|-- SKILL.md                    # Decision trees + navigation (~200 lines)
'-- references/
    |-- product-a/
    |   |-- README.md           # Overview, quick start
    |   |-- api.md              # Runtime APIs
    |   |-- configuration.md    # Setup/config
    |   |-- patterns.md         # Best practices
    |   '-- gotchas.md          # Pitfalls
    '-- product-b/
        '-- ... (same structure)
```

**When to use:**
- Large platforms (10+ products/features)
- Need to avoid loading everything at once
- Different products for different tasks

**Example:** AWS, GCP, Cloudflare, large internal platforms.

## File Size Guidelines

| File Type | Target | Max |
|-----------|--------|-----|
| SKILL.md | 150-200 lines | 500 lines |
| Reference file | 100-150 lines | 200 lines |
| Any single file | - | 500 lines |

**Why these limits?**
- Agent loads full file into context when reading
- Large files = context rot = worse performance
- Split content, not tokens

## Bundled Resources

### scripts/

Executable code the agent runs directly.

- Include when same code gets rewritten repeatedly
- Include when deterministic operations are needed
- Scripts are executed, not loaded into context (zero token cost)

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f "$1" ]]; then
    echo "Error: File not found: $1" >&2
    exit 1
fi
```

### references/

Documentation loaded into agent context on-demand.

- Include for domain knowledge, API docs, schemas, workflow guides
- Target 100-150 lines per file, max 200
- Token cost only when read

### assets/

Files used in output, not loaded into context.

- Templates (`.yaml`, `.json`), images, boilerplate code
- Agent copies/uses files without loading into context
- Zero token cost

### Comparison

| Directory | Purpose | Token Cost | Agent Action |
|-----------|---------|------------|--------------|
| scripts/ | Automation | Zero | Execute |
| references/ | Documentation | When read | Read |
| assets/ | Output files | Zero | Copy/use |

## Token Budget by Pattern

| Pattern | Typical Load | Notes |
|---------|--------------|-------|
| Minimal | ~500 tokens | Single file |
| With scripts | ~600 tokens | SKILL.md + script refs |
| Reference-heavy | ~800-2000 tokens | Depends on files read |
| Progressive | ~2000-5000 tokens | SKILL.md + relevant refs |

## Naming Conventions

### Directories

| Rule | Good | Bad |
|------|------|-----|
| Lowercase + hyphens | `my-skill` | `MySkill`, `my_skill` |
| Match `name:` field | `pdf-processor` | `pdf_proc` |
| Descriptive | `data-validator` | `util`, `helper` |

### Files

| Directory | Convention |
|-----------|------------|
| `references/` | Descriptive: `api.md`, `schemas.md`, `workflows.md` |
| `scripts/` | Action-based: `validate.sh`, `deploy.sh`, `convert.sh` |
| `assets/` | Content-based: `template.yaml`, `logo.png` |
