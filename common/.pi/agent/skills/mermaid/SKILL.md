---
name: mermaid
description: Validate Mermaid diagrams by parsing and rendering them with Mermaid CLI before you embed them in docs.
argument-hint: "[diagram-path] [output-svg]"
disable-model-invocation: true
---

Use this skill to validate Mermaid diagrams before embedding them in Markdown or documentation.

Validator command:

```bash
bash "${CLAUDE_SKILL_DIR}/tools/validate.sh" diagram.mmd [output.svg]
```

Workflow:
1. Draft the diagram in a standalone `.mmd` file first.
2. Run the validator.
3. Fix any syntax or rendering errors.
4. Copy the validated Mermaid block into the target Markdown or docs file.

The validator parses and renders the Mermaid source, prints a best-effort ASCII preview, and exits non-zero when the diagram is invalid.
