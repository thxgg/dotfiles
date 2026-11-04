# Linux Home Payload

Linux desktop contracts in addition to the root repository rules.

## Current Configuration
- Hyprland and GTK select the private `macOS-27` cursor. Lua `cursor-scale.lua` selects size 36 on DP-3 and 24 elsewhere from pointer location, without changing desktop scaling; legacy config stays at 24. Apple assets stay machine-local; `~/.config/hypr/CURSORS.md` documents conversion, installation, validation, and rollback. Fresh machines need a separate theme build.
- Hex dictation uses Right Ctrl through Hyprland's GlobalShortcuts dispatcher. Portal action names include Hex's saved chord even when Hyprland assigns a different physical key; update both Hyprland configs if those saved chords change.
- Hyprland's Lua config loads `exclusive-workspace.lua`: WoW launches on the main monitor's active workspace and sends its occupants to the next numbered workspace. It returns destination occupants to its source when manually moved, and sends incoming apps to the next numbered workspace. Flameshot windows are exempt from workspace eviction. WoW's mouse move/resize, floating toggle, and scratchpad move are guarded. Legacy `.conf` retains only the supported initial-state rules.
- Hyprland's Lua config loads `flameshot-placement.lua`: after a Flameshot window opens, a one-shot callback restores its position to the configured desktop origin `(0, 0)`. This corrects Hyprland 0.57's single-monitor floating-window constraint without changing global placement settings. Legacy `.conf` has only static rules and cannot apply this correction.
- GTK, Kvantum, Hyprland, and Rofi select Catppuccin Mocha with Lavender accents. OS-wide appearance remains a native, machine-local setting.
- HyprPanel intentionally keeps its black-and-white OLED overrides. Its compatibility launcher unmaps the bar on a monitor whose active workspace contains fullscreen World of Warcraft; it restores only automatically hidden bars.
- Hyprsunset starts through its packaged user service with Hyprland. `.config/hypr/hyprsunset.conf` applies 4500 K from 21:00 to 06:00 local time and identity (no filter) during the day. HyprPanel's custom night-light module uses IPC: left-click overrides until the next profile switch, right-click restores the current scheduled profile. Do not use the built-in process-killing toggle with this schedule.
- Wofi clipboard menus explicitly select `~/.config/wofi/style-dark.css`.
- HyprPanel manages the static wallpaper through the swww/awww compatibility wrappers. Personal wallpaper files remain machine-local.
- Locking uses an optional private, pinned Hyprlock video build with a stock static fallback. See `.config/hypr/LOCKING.md` for build and live-test instructions.
- The 15-minute lock / 30-minute display-off policy is opt-in through `session-control.py enable-idle`. No automatic suspend or manual lock keybinding is configured. WoW inhibits idle whenever its matching game window exists.

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
