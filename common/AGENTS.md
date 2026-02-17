# Common Home Tree

## Purpose & Scope
`common/` is the stow package that mirrors `$HOME`.
Anything committed here is expected to be deployed directly to the machine by `safe-stow.sh`.

## Entry Points & Contracts
- Deployment target: repo root scripts `safe-stow.sh` and `unstow.sh`.
- Contract: paths in `common/` map 1:1 to `$HOME` relative paths.
- Health checks: `doctor.sh` validates key symlinked paths.

## Usage Patterns
- **Add a new dotfile**: create path under `common/` first, then run `./safe-stow.sh`.
- **Update existing config**: edit tracked file in `common/`, not the live file in `$HOME`.
- **Machine secrets**: keep only references in tracked shell config; values live in `~/.env.secrets`.

## Anti-Patterns
- Editing `$HOME/.zshrc`, `$HOME/.gitconfig`, or `$HOME/.config/*` directly and not syncing back.
- Stowing from a different package root (this repo expects `common` only).
- Tracking generated dependency trees except where explicitly intentional.

## Dependencies & Edges
- Uplink: [Root](../AGENTS.md)
- Downlinks:
  - [Config Tree](./.config/AGENTS.md)

## Patterns & Pitfalls
- `common/Library/Application Support/...` entries are valid stow targets but can hit macOS permission boundaries on parent directories.
- Parent symlink deployment (`~/.config` -> `common/.config`) means children may appear as regular files while still being managed correctly.
- Empty directories are not meaningful stow artifacts; manage concrete files/symlinks instead.
