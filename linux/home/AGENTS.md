# Linux Home Payload

## Purpose & Scope
Contains Linux-only dotfiles mirrored into `$HOME` by `safe-stow.sh`.

## Contract
- Paths map 1:1 to `$HOME`.
- Do not duplicate paths that already exist in `common/`.

## Usage
- Put Linux-specific app configs here (for example `.config/hypr/...`).
- Keep shared configs in `common/`.
- Keep Hyprland Lua and legacy `.conf` configuration changes aligned where supported.
- Keep static light/dark assets. Do not add theme-changing scripts, shared theme-state readers, or panel theme toggles. Select themes in application configuration.
- Do not restore the Nautilus wallpaper polling service.
- Before deploying removal of the wallpaper service on an existing Linux machine, run `systemctl --user disable --now nautilus-wallpaper-sync.service`. Remove its installed unit and enablement link, then run `systemctl --user daemon-reload`.
- Wallpaper management is disabled by default. Configure an existing local image explicitly; no personal wallpaper symlinks are deployed. Select an installed Kvantum theme with the application's own settings.
- GTK uses the installed theme, not vendored full-theme user CSS. Do not restore dark CSS overrides that prevent light mode.
- Recording stop copies a Wayland file URI and offers a separate plain-path action. Keep notification actions tied to the original recording, not a mutable last-recording file.
- Validate Hyprland, GTK/Qt, tray integration, and systemd behavior on Linux; macOS syntax checks do not validate a Linux desktop session.
