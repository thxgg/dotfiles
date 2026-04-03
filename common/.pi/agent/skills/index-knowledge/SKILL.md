---
name: index-knowledge
description: Generate or refresh a hierarchical AGENTS.md knowledge base for a codebase. Use when a repository needs maintained root and subtree intent files.
argument-hint: "[--create-new] [--max-depth=N]"
disable-model-invocation: true
---

Generate or refresh `AGENTS.md` files that capture repo-specific knowledge at semantic boundaries.

Workflow:
1. Inventory existing `AGENTS.md` and `CLAUDE.md` files before editing anything.
2. Analyze structure, entry points, commands, conventions, anti-patterns, and major subtrees.
3. Create or update a root `AGENTS.md` first.
4. Add child `AGENTS.md` files only where a subtree has distinct responsibilities, conventions, or enough complexity to justify local guidance.
5. Keep child files additive: do not repeat parent content unless it materially changes in that subtree.
6. Exclude generated or vendor output such as `node_modules`, `.git`, `dist`, `build`, coverage output, and compiled artifacts.
7. Preserve or repair uplink/downlink links between intent nodes.
8. If invoked with `--create-new`, read existing files for context before replacing them.

Quality bar:
- specific to this codebase
- concise and scannable
- focused on where to look, conventions, anti-patterns, and commands
- no generic engineering advice
- prefer updating existing files over creating redundant siblings

See [references/intent-layer-spec.md](references/intent-layer-spec.md) for the full intent-node structure and section guidance.
