# macOS Bootstrap

## Purpose & Scope
macOS bootstrap based on Homebrew plus post-install runtime initialization.
This area owns package manifests, mac-specific service/tool setup, and macOS-only stow payload.

## Entry Points & Contracts
- Entrypoint: `macos/setup.sh`.
- Package source of truth: `macos/Brewfile`.
- Dotfile payload root: `macos/home/` (mirrors `$HOME` for macOS-only files).
- Install flow: ensure Homebrew -> update/upgrade -> `brew bundle` -> service/tool setup.
- Current pinned database formula: `postgresql@18`.

## Usage Patterns
- Add/remove formulae/casks in `Brewfile` first.
- Keep macOS-only dotfiles in `macos/home/` and out of `common/`.
- Keep `setup.sh` focused on orchestration and post-install initialization.
- Validate state without installing new packages:
```bash
brew bundle check --file=./macos/Brewfile
```

## Anti-Patterns
- Reintroducing imperative per-package loops in `setup.sh`.
- Adding Linux-specific setup logic here.
- Hiding package decisions in script branches instead of `Brewfile` diffs.

## Dependencies & Edges
- Uplink: [Root](../AGENTS.md)
- Downlinks: none

## Patterns & Pitfalls
- Service names are formula-specific (`postgresql@18`, `redis`).
- Apple Silicon vs Intel PATH initialization is handled in-script; preserve both paths.
