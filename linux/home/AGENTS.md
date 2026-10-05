# Linux Home Payload

Linux desktop contracts in addition to the root repository rules.

## Current Configuration
- GTK, Kvantum, Hyprland, and Rofi select Catppuccin Mocha with Lavender accents. OS-wide appearance remains a native, machine-local setting.
- HyprPanel intentionally keeps its black-and-white OLED overrides. Its compatibility launcher unmaps the bar on a monitor whose active workspace contains fullscreen World of Warcraft; it restores only automatically hidden bars.
- Wofi clipboard menus explicitly select `~/.config/wofi/style-dark.css`.
- Wallpaper management is disabled by default.

## Desktop Contracts
- Keep Hyprland Lua and legacy `.conf` configuration changes aligned where supported, including stylesheet selection. Use installed launcher commands, not retired `~/.local/bin/rofi` or `~/.local/bin/wofi` wrappers.
- Do not restore the Nautilus wallpaper polling service. Before deploying its removal on an existing Linux machine, run `systemctl --user disable --now nautilus-wallpaper-sync.service`. Remove its installed unit and enablement link, then run `systemctl --user daemon-reload`.
- Configure an existing local image explicitly; do not deploy personal wallpaper symlinks. Select an installed Kvantum theme in the application's settings.
- GTK uses the installed theme, not vendored full-theme user CSS. Do not restore dark CSS overrides that prevent light mode.
- Recording stop copies a Wayland file URI and offers a separate plain-path action. Keep notification actions tied to the original recording, not a mutable last-recording file.

## Validation
Validate Hyprland, GTK/Qt, tray integration, and systemd behavior on Linux. macOS syntax checks and mocked tests do not validate a Linux desktop session.

## Navigation
- [Linux Bootstrap](../AGENTS.md)
