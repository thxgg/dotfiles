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
- Theme application is manual. Do not add session-start theme application or restore the Nautilus wallpaper polling service.
- Keep static light/dark assets and the manual HyprPanel theme toggle. The panel and Teams tray can read the manually selected theme mode.
- Before deploying removal of the wallpaper service on an existing Linux machine, run `systemctl --user disable --now nautilus-wallpaper-sync.service`. Remove its installed unit and enablement link, then run `systemctl --user daemon-reload`.
- Wallpaper management is disabled by default. Configure an existing local image explicitly; no personal wallpaper symlinks are deployed. Generated Kvantum assets still require explicit `theme-mode apply`.
- GTK uses the installed theme, not vendored full-theme user CSS. Do not restore dark CSS overrides that prevent light mode.
- Recording stop copies a Wayland file URI and offers a separate plain-path action. Keep notification actions tied to the original recording, not a mutable last-recording file.
- Validate Hyprland, GTK/Qt, tray integration, and systemd behavior on Linux; macOS syntax checks do not validate a Linux desktop session.
