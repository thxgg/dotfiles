# Neovim Config

Modular Neovim setup using `lazy.nvim`, with `core`, `plugins`, and `user` layers.

## Current Architecture
- `init.lua` loads `core`, then `user`.
- Core loads `options`, `mappings`, `lazy`, then `diagnostics`.
- `lua/core/lazy.lua` imports plugin specs from `lua/plugins/`. `lazy-lock.json` pins plugin revisions.

## Configuration Rules
- Keep plugin changes in focused files under `lua/plugins/`, editor-wide defaults in `lua/core/`, and personal behavior in `lua/user/`.
- Keep snippets in `snippets/*.json`; update completion configuration when their schema changes.
- Use environment or Neovim paths instead of user-specific absolute paths.
- Avoid duplicate plugin specs or overlapping aliases without a clear reason. Use a consistent keymap API in new code.
- Use consistent augroups so reloading autocmds does not duplicate handlers.

## Validation
For covered LSP, DAP, mapping, and theme behavior, run the isolated checks from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/common-config.test.py
```

These checks stub plugin interfaces; they do not verify real language servers or full plugin startup. For integration checks, prefer an isolated checkout or configuration with separate user data and dependencies. Use the deployed configuration only when the check specifically requires it. A live `nvim --headless "+q"` startup loads user configuration and can bootstrap plugins; it is not an isolated offline check.

## Navigation
- [Common Home Tree](../../AGENTS.md)
