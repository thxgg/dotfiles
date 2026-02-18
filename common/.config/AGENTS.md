# Config Tree

## Purpose & Scope
Holds application/tool config deployed under `$HOME/.config`.
This node covers shared layout and ownership boundaries across apps.

## Entry Points & Contracts
- Canonical location for app config: `common/.config/<tool>/...`.
- Top-level deployment path is a real `$HOME/.config` directory with leaf-linked managed entries.
- Heavy domains are split into child intent nodes.

## Usage Patterns
- Keep app config minimal and reproducible; avoid committing runtime cache/state.
- For new tools, add dedicated subdirectory and update root docs if operationally important.
- Validate key paths after changes with `./doctor.sh`.

## Anti-Patterns
- Committing auth state unless explicitly intended and reviewed (`gh/hosts.yml` class files).
- Adding machine-only binaries or generated blobs in this tree without ignore rules.
- Mixing broad OS bootstrap logic here (belongs in `macos/` or `linux/`).

## Dependencies & Edges
- Uplink: [Common Home Tree](../CLAUDE.md)
- Downlinks:
  - [Neovim Config](./nvim/CLAUDE.md)
  - [OpenCode Config](./opencode/CLAUDE.md)

## Patterns & Pitfalls
- `nvim` and `opencode` are the highest-churn subtrees; treat them as independent domains.
- Keep `.gitignore` entries aligned when adding any generated output under `.config`.
