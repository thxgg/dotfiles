# Neovim Config

## Purpose & Scope
Modular Neovim setup using `lazy.nvim`, split into `core`, `plugins`, and `user` layers.
This node covers editor behavior and plugin architecture only.

## Entry Points & Contracts
- Entrypoint: `init.lua` loads `require("core")` then `require("user")`.
- Core load order: `lua/core/init.lua` -> `options`, `mappings`, `lazy`, `diagnostics`.
- Plugin registration: `lua/core/lazy.lua` imports all plugin specs from `lua/plugins`.
- Lockfile contract: `lazy-lock.json` pins plugin revisions.

## Usage Patterns
- Add/modify plugins by editing one focused file under `lua/plugins/`.
- Keep editor-wide defaults in `lua/core/*`; keep personal behavior in `lua/user/*`.
- Keep snippets in `snippets/*.json` and update completion config if schema changes.

## Anti-Patterns
- Hardcoding user-specific absolute paths (currently hotspots in `lua/plugins/lsp.lua`).
- Adding duplicate plugin specs or overlapping plugin aliases without clear intent.
- Mixing global keymap styles (`vim.api.nvim_set_keymap` vs `vim.keymap.set`) within new code.

## Dependencies & Edges
- Uplink: [Config Tree](../CLAUDE.md)
- Downlinks: none

## Patterns & Pitfalls
- `lsp.lua` is the largest/highest-risk file; isolate changes and test headless startup.
- Autocmd-heavy changes can duplicate handlers if augroup strategy is inconsistent.
- Quick sanity check after edits:
```bash
nvim --headless "+lua require('core')" "+q"
```
