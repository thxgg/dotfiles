# Linux Home Payload

Linux desktop contracts in addition to the root repository rules.

## Current Configuration
- Handy uses the app-scoped DMA-BUF launcher in `.config/handy-launcher/` for the WebKitGTK 2.54 overlay bug. Hyprland owns its autostart and Super+O toggle; keep Handy's built-in autostart off. The user desktop entry uses the same launcher. An optional private Handy v0.9.8 build uses Catppuccin Latte/Mocha with Lavender accents, selected through `~/.local/share/handy-catppuccin/current`; the package remains the fallback. See `.config/handy-launcher/README.md` for deployment, rebuilding, and removal.
- Hyprland's Lua config loads `exclusive-workspace.lua`: WoW launches on the next empty per-monitor workspace, returns destination occupants to its source when moved, and sends incoming apps to the next numbered workspace. WoW's mouse move/resize, floating toggle, and scratchpad move are guarded. Legacy `.conf` retains only the supported initial-state rules.
- GTK, Kvantum, Hyprland, and Rofi select Catppuccin Mocha with Lavender accents. OS-wide appearance remains a native, machine-local setting.
- HyprPanel intentionally keeps its black-and-white OLED overrides. Its compatibility launcher unmaps the bar on a monitor whose active workspace contains fullscreen World of Warcraft; it restores only automatically hidden bars.
- Wofi clipboard menus explicitly select `~/.config/wofi/style-dark.css`.
- HyprPanel manages the static wallpaper through the swww/awww compatibility wrappers. Personal wallpaper files remain machine-local.
- Locking uses an optional private, pinned Hyprlock video build with a stock static fallback. See `.config/hypr/LOCKING.md` for build and live-test instructions.
- The 15-minute lock / 30-minute display-off policy is opt-in through `session-control.py enable-idle`. No automatic suspend or manual lock keybinding is configured. WoW inhibits idle whenever its matching game window exists.

## Desktop Contracts
- Every Handy update must include a rebuild of the private Catppuccin variant. Updating `handy-bin` alone leaves the selected private binary on its old version. Follow `.config/handy-launcher/README.md` → Required update procedure: review source/runtime pins, refresh the patch, rebuild, test, and select the new build. Keep the previous working build for rollback.
- Keep Hyprland Lua and legacy `.conf` configuration changes aligned where supported, including stylesheet selection. Use installed launcher commands, not retired `~/.local/bin/rofi` or `~/.local/bin/wofi` wrappers.
- Do not restore the Nautilus wallpaper polling service. Before deploying its removal on an existing Linux machine, run `systemctl --user disable --now nautilus-wallpaper-sync.service`. Remove its installed unit and enablement link, then run `systemctl --user daemon-reload`.
- Configure an existing local image explicitly; do not deploy personal wallpaper symlinks. Select an installed Kvantum theme in the application's settings.
- GTK uses the installed theme, not vendored full-theme user CSS. Do not restore dark CSS overrides that prevent light mode.
- Recording stop copies a Wayland file URI and offers a separate plain-path action. Keep notification actions tied to the original recording, not a mutable last-recording file.

## Validation
Validate Hyprland, GTK/Qt, tray integration, and systemd behavior on Linux. macOS syntax checks and mocked tests do not validate a Linux desktop session.

## Navigation
- [Linux Bootstrap](../AGENTS.md)
