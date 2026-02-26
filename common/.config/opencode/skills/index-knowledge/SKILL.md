---
name: index-knowledge
description: Generate hierarchical AGENTS.md knowledge base for a codebase. Creates root + complexity-scored subdirectory documentation with parallel agent exploration.
---

# index-knowledge

Generate hierarchical AGENTS.md files providing AI agents with context-aware guidance. Root + complexity-scored subdirectories.

## Usage

```
/index-knowledge              # Update mode: modify existing + create new where warranted
/index-knowledge --create-new # Read existing -> remove all -> regenerate from scratch
/index-knowledge --max-depth=3 # Limit directory depth (default: 5)
```

See [$SKILL_DIR/references/intent-layer-spec.md] for the full intent node specification.

---

## Workflow Overview

<critical>
**TodoWrite ALL phases. Mark in_progress -> completed in real-time.**

```
TodoWrite([
  { content: "Discovery: parallel explore + LSP + read existing", status: "pending", activeForm: "Running discovery phase" },
  { content: "Scoring: score directories, determine locations", status: "pending", activeForm: "Scoring directories" },
  { content: "Generate: create AGENTS.md files (root + subdirs)", status: "pending", activeForm: "Generating AGENTS.md files" },
  { content: "Review: deduplicate, validate, trim", status: "pending", activeForm: "Reviewing generated files" }
])
```
</critical>

---

## Phase 1: Discovery + Analysis (Concurrent)

**Mark "Discovery" as in_progress.**

### Launch Parallel Explore Agents

Multiple Task calls in a single message execute in parallel. Results return directly.

```
// All Task calls in ONE message = parallel execution

Task(
  description="project structure",
  subagent_type="Explore",
  prompt="Project structure: PREDICT standard patterns for detected language -> REPORT deviations only"
)

Task(
  description="entry points",
  subagent_type="Explore",
  prompt="Entry points: FIND main files -> REPORT non-standard organization"
)

Task(
  description="conventions",
  subagent_type="Explore",
  prompt="Conventions: FIND config files (.eslintrc, pyproject.toml, .editorconfig) -> REPORT project-specific rules"
)

Task(
  description="anti-patterns",
  subagent_type="Explore",
  prompt="Anti-patterns: FIND 'DO NOT', 'NEVER', 'ALWAYS', 'DEPRECATED' comments -> LIST forbidden patterns"
)

Task(
  description="build/ci",
  subagent_type="Explore",
  prompt="Build/CI: FIND .github/workflows, Makefile -> REPORT non-standard patterns"
)

Task(
  description="test patterns",
  subagent_type="Explore",
  prompt="Test patterns: FIND test configs, test structure -> REPORT unique conventions"
)
```

### Dynamic Agent Spawning

After bash analysis, spawn ADDITIONAL explore agents based on project scale:

| Factor | Threshold | Additional Agents |
|--------|-----------|-------------------|
| **Total files** | >100 | +1 per 100 files |
| **Total lines** | >10k | +1 per 10k lines |
| **Directory depth** | >=4 | +2 for deep exploration |
| **Large files (>500 lines)** | >10 files | +1 for complexity hotspots |
| **Monorepo** | detected | +1 per package/workspace |
| **Multiple languages** | >1 | +1 per language |

```bash
# Measure project scale first
total_files=$(find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/venv/*' -not -path '*/dist/*' -not -path '*/build/*' | wc -l)
total_lines=$(find . -type f \( -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.java" -o -name "*.rs" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
large_files=$(find . -type f \( -name "*.ts" -o -name "*.py" -o -name "*.java" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | awk '$1 > 500 {count++} END {print count+0}')
max_depth=$(find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*' | awk -F/ '{print NF}' | sort -rn | head -1)
```

### Main Session: Concurrent Analysis

**While Task agents execute**, main session does:

#### 1. Bash Structural Analysis
```bash
# Directory depth + file counts
find . -type d -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/venv/*' -not -path '*/dist/*' -not -path '*/build/*' | awk -F/ '{print NF-1}' | sort -n | uniq -c

# Files per directory (top 30)
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -30

# Code concentration by extension
find . -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.go" -o -name "*.rs" -o -name "*.java" \) -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20

# Existing AGENTS.md / AGENTS.md
find . -type f \( -name "AGENTS.md" -o -name "AGENTS.md" \) -not -path '*/node_modules/*' 2>/dev/null
```

#### 2. Read Existing AGENTS.md Files
```
For each existing file found:
  Read(file_path=file)
  Extract: key insights, conventions, anti-patterns
  Store in EXISTING_DOCS map
```

If `--create-new`: Read all existing first (preserve context) -> then delete all -> regenerate.

#### 3. LSP Codemap (if available)
```
# Entry points (parallel)
LSP(operation="documentSymbol", filePath="src/index.ts", line=1, character=1)
LSP(operation="documentSymbol", filePath="main.py", line=1, character=1)

# Key symbols (parallel)
LSP(operation="workspaceSymbol", filePath=".", line=1, character=1)  # classes
LSP(operation="workspaceSymbol", filePath=".", line=1, character=1)  # interfaces

# Centrality for top exports
LSP(operation="findReferences", filePath="...", line=X, character=Y)
```

**LSP Fallback**: If unavailable, rely on explore agents + grep patterns.

**Merge: bash + LSP + existing + Task agent results. Mark "Discovery" as completed.**

---

## Phase 2: Scoring & Location Decision

**Mark "Scoring" as in_progress.**

### Scoring Matrix

| Factor | Weight | High Threshold | Source |
|--------|--------|----------------|--------|
| File count | 3x | >20 | bash |
| Subdir count | 2x | >5 | bash |
| Code ratio | 2x | >70% | bash |
| Unique patterns | 1x | Has own config | explore |
| Module boundary | 2x | Has index.ts/__init__.py | bash |
| Symbol density | 2x | >30 symbols | LSP |
| Export count | 2x | >10 exports | LSP |
| Reference centrality | 3x | >20 refs | LSP |

### Decision Rules

| Score | Action |
|-------|--------|
| **Root (.)** | ALWAYS create |
| **>15** | Create AGENTS.md |
| **8-15** | Create if distinct domain |
| **<8** | Skip (parent covers) |

### Output
```
AGENTS_LOCATIONS = [
  { path: ".", type: "root" },
  { path: "src/hooks", score: 18, reason: "high complexity" },
  { path: "src/api", score: 12, reason: "distinct domain" }
]
```

**Mark "Scoring" as completed.**

---

## Phase 3: Generate AGENTS.md Files

**Mark "Generate" as in_progress.**

### Root AGENTS.md (Full Treatment)

```markdown
# PROJECT KNOWLEDGE BASE

## Overview
{1-2 sentences: what + core stack}

## Structure
\`\`\`
{root}/
├── {dir}/    # {non-obvious purpose only}
└── {entry}
\`\`\`

## Where to Look
| Task | Location | Notes |
|------|----------|-------|

## Code Map
{From LSP - skip if unavailable or project <10 files}

| Symbol | Type | Location | Refs | Role |

## Conventions
{ONLY deviations from standard}

## Anti-Patterns (This Project)
{Explicitly forbidden here}

## Commands
\`\`\`bash
{dev/test/build}
\`\`\`

## Intent Nodes
- [Child Area](./path/AGENTS.md) - brief description
```

**Quality gates**: 50-150 lines, no generic advice, no obvious info.

### Subdirectory AGENTS.md (Parallel)

Launch general-purpose agents for each location in ONE message (parallel execution):

```
// All in single message = parallel
Task(
  description="AGENTS.md for src/hooks",
  subagent_type="general-purpose",
  prompt="Generate AGENTS.md for: src/hooks
    - Reason: high complexity
    - 30-80 lines max
    - NEVER repeat parent content
    - Sections: Purpose & Scope, Entry Points, Usage Patterns, Anti-Patterns, Dependencies
    - Include Uplink to parent, Downlinks to children
    - Write directly to src/hooks/AGENTS.md"
)

Task(
  description="AGENTS.md for src/api",
  subagent_type="general-purpose",
  prompt="Generate AGENTS.md for: src/api
    - Reason: distinct domain
    - 30-80 lines max
    - NEVER repeat parent content
    - Sections: Purpose & Scope, Entry Points, Usage Patterns, Anti-Patterns, Dependencies
    - Include Uplink to parent, Downlinks to children
    - Write directly to src/api/AGENTS.md"
)
// ... one Task per AGENTS_LOCATIONS entry
```

### Intent Node Template

```markdown
# [Area Name]

## Purpose & Scope
What this area handles. What it does NOT handle.

## Entry Points & Contracts
Main APIs, key functions, invariants that must hold.

## Usage Patterns
Canonical examples with code snippets from this codebase.

## Anti-Patterns
What NOT to do, with BAD/GOOD examples.

## Dependencies & Edges
- Uplink: [Parent](../AGENTS.md)
- Downlinks: [Child](./child/AGENTS.md)

## Patterns & Pitfalls
Lessons learned, edge cases, debugging tips.
```

**Results return directly. Mark "Generate" as completed.**

---

## Phase 4: Review & Deduplicate

**Mark "Review" as in_progress.**

For each generated file:
- Remove generic advice (applies to ALL projects)
- Remove parent duplicates (child never repeats parent)
- Trim to size limits (root: 50-150 lines, subdirs: 30-80 lines)
- Verify telegraphic style
- Check all relative links resolve correctly

**Mark "Review" as completed.**

---

## Final Report

```
=== index-knowledge Complete ===

Mode: {update | create-new}

Files:
  + ./AGENTS.md (root, {N} lines)
  + ./src/hooks/AGENTS.md ({N} lines)

Dirs Analyzed: {N}
AGENTS.md Created: {N}
AGENTS.md Updated: {N}

Hierarchy:
  ./AGENTS.md
  └── src/hooks/AGENTS.md
      └── src/hooks/auth/AGENTS.md
```

---

## Token Budget Guidelines

| Node Type | Target Size | Maximum |
|-----------|-------------|---------|
| Root | 100 lines | 150 lines |
| Layer | 60 lines | 80 lines |
| Leaf | 40 lines | 60 lines |

### Efficiency Tips
- Use downlinks for detail instead of including everything
- Reference existing docs instead of copying
- One good code example beats three mediocre ones
- Focus on what AI agents actually need to know

---

## Anti-Patterns (AVOID)

- **Static agent count**: MUST vary agents based on project size/depth
- **Sequential execution**: MUST parallel (multiple Task calls in one message)
- **Ignoring existing**: ALWAYS read existing first, even with --create-new
- **Over-documenting**: Not every dir needs AGENTS.md
- **Redundancy**: Child never repeats parent
- **Generic content**: Remove anything that applies to ALL projects
- **Verbose style**: Telegraphic or die
- **Stale links**: Verify all relative links resolve
