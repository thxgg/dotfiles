---
name: mermaid
description: Validate Mermaid diagrams by parsing and rendering with Mermaid CLI.
---

# Mermaid Skill

Use this skill to quickly validate Mermaid diagrams before embedding them in Markdown or docs.

## Prerequisites

- Node.js + npm (for `npx`).
- First run downloads a headless Chromium via Puppeteer. If Chromium is missing, set `PUPPETEER_EXECUTABLE_PATH`.

## Tool

### Validate a diagram

```bash
bash "$SKILL_DIR/tools/validate.sh" diagram.mmd [output.svg]
```

- Parses and renders the Mermaid source.
- Non-zero exit means invalid Mermaid syntax.
- Prints an ASCII preview using `beautiful-mermaid` (best effort; not all diagram types are supported).
- If `output.svg` is omitted, the SVG is rendered to a temp file and discarded.

## Workflow

1. If the diagram will live in Markdown, draft it in a standalone `diagram.mmd` first (the tool validates plain Mermaid files).
2. Write or update `diagram.mmd`.
3. Run `bash "$SKILL_DIR/tools/validate.sh" diagram.mmd`.
4. Fix errors shown by the CLI.
5. Once valid, copy the Mermaid block into your target Markdown file.

---

Adapted from `mitsuhiko/agent-stuff` (Apache-2.0), `skills/mermaid/SKILL.md` and `skills/mermaid/tools/validate.sh`.
