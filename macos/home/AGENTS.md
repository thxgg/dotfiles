# macOS Home Payload

## Purpose & Scope
Contains macOS-only dotfiles mirrored into `$HOME` by `safe-stow.sh`.

## Contract
- Paths map 1:1 to `$HOME`.
- Do not duplicate paths that already exist in `common/`.

## Usage
- Put macOS-specific app configs here (for example `Library/...` or `.config/...`).
- Keep shared configs in `common/`.
- Ghostty configuration and Catppuccin themes live in `Library/Application Support/com.mitchellh.ghostty/`.
- `Library/LaunchAgents/com.thxgg.gui-path.plist` sets PATH for GUI applications at login. Use a shell to expand `$HOME`; launchd does not expand it in plain arguments.
- Do not restore the removed artifact-cloud or theme synchronization LaunchAgents.
