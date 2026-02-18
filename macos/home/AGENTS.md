# macOS Home Payload

## Purpose & Scope
Contains macOS-only dotfiles mirrored into `$HOME` by `safe-stow.sh`.

## Contract
- Paths map 1:1 to `$HOME`.
- Do not duplicate paths that already exist in `common/`.

## Usage
- Put macOS-specific app configs here (for example `Library/...` or `.config/aerospace/...`).
- Keep shared configs in `common/`.
