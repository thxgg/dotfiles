# Common Home Tree

## Purpose & Scope
`common/` is the shared stow payload that mirrors `$HOME` across macOS and Linux.
OS-specific payload lives in `macos/home/` and `linux/home/`.

## Entry Points & Contracts
- Deployment target: repo root scripts `safe-stow.sh` and `unstow.sh`.
- Contract: paths in `common/` map 1:1 to `$HOME` relative paths and must be cross-platform safe.
- Health checks: `doctor.sh` validates key symlinked paths.

## Usage Patterns
- **Add a shared dotfile**: create path under `common/`, then run `./safe-stow.sh`.
- **Add an OS-specific dotfile**: create path under `macos/home/` or `linux/home/`.
- **Update existing config**: edit tracked file in `common/`, not the live file in `$HOME`.
- **Machine secrets**: keep only references in tracked shell config; values live in `~/.env.secrets`.

## Anti-Patterns
- Editing `$HOME/.zshrc`, `$HOME/.gitconfig`, or `$HOME/.config/*` directly and not syncing back.
- Defining the same target path in `common/` and an OS-specific stow root.
- Tracking generated dependency trees except where explicitly intentional.

## Dependencies & Edges
- Uplink: [Root](../AGENTS.md)
- Downlinks:
  - [Config Tree](./.config/AGENTS.md)

## Patterns & Pitfalls
- macOS-only targets like `~/Library/...` belong in `macos/home/`, not `common/`.
- Child-link deployment keeps `~/.config` as a real directory; each direct child is symlinked from active roots.
- Empty directories are not meaningful stow artifacts; manage concrete files/symlinks instead.
