# Linux Home Payload

## Purpose & Scope
Contains Linux-only dotfiles mirrored into `$HOME` by `safe-stow.sh`.

## Contract
- Paths map 1:1 to `$HOME`.
- Do not duplicate paths that already exist in `common/`.

## Usage
- Put Linux-specific app configs here (for example `.config/hypr/...`).
- Keep shared configs in `common/`.
