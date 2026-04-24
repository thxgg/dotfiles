# Cloudflare Theme Plan

## Context

Prepare a Cloudflare-inspired theme across these managed dotfiles/configs:

- GTK
- Qt / Kvantum
- Hyprland
- HyprPanel
- rofi (the current `SUPER+SPACE` app launcher)
- wofi (used in clipboard picker flows)
- btop
- nvim
- ghostty
- lazydocker
- lazygit
- tmux
- starship
- Pi

Current repo state is mostly Catppuccin-based (`mocha` for dark, `latte` palette already present in some places). There is also an existing Linux-only orange-focused palette in `linux/home/.config/hypr/oled-orange.conf` and matching HyprPanel overrides that already lean toward the desired Cloudflare/OLED direction.

User preferences clarified:

- lean closer to the existing OLED / Cloudflare-orange direction than to `orng.nvim`
- light mode should be a true light theme, not a warm cream/tan variant
- add a theme toggle entry to the HyprPanel dashboard menu by replacing the current `Nvim` shortcut
- coordinated switching should cover the target apps as much as their native reload behavior allows
- next-launch application of theme changes is acceptable for apps that do not hot-reload cleanly
- native per-app theme implementations are acceptable, but they should be kept in sync and documented in `AGENTS.md`
- `rofi` is the current `SUPER+SPACE` launcher, and `wofi` is still used in clipboard picker flows, so both need Cloudflare variants

Need final theme support for both dark and light mode, with a single Linux menu action to switch modes.

## Approach

- Define a single Cloudflare-inspired palette pair first: one dark palette and one true-light palette, mapped onto semantic roles already used across the repo (`base`, `surface*`, `overlay*`, `text`, accent roles).
- Use the existing OLED/Cloudflare-orange files as the starting accent direction, then derive a matching light palette rather than designing from scratch.
- Keep the source of truth as native per-app theme assets in-repo, but avoid rewriting tracked stow-managed files when the user toggles modes.
- Add a single theme controller entry point (likely a new script under `common/.local/bin/` and invoked from HyprPanel) that stores the active mode outside the repo (for example under `~/.local/state/theme/`) and triggers best-effort reloads.
- Reuse each tool’s native theming mechanism instead of inventing a universal renderer:
  - GTK: real light/dark CSS files plus a runtime preference switch for which variant GTK apps should prefer
  - Qt / Kvantum: tracked dark/light theme assets plus a small runtime selection mechanism
  - Hyprland: tracked dark/light palette files with a runtime-selected sourced theme include
  - HyprPanel: launch through a runtime overlay directory assembled by `start-hyprpanel.sh`, so the active config/CSS variant can change without editing tracked files
  - Ghostty: custom theme files with built-in light/dark theme support and/or an optional runtime include
  - nvim/tmux: read the shared mode and apply the correct palette on startup/reload
  - Pi, btop, lazygit, lazydocker, rofi, and starship: prefer wrapper-selected native config/theme files so toggling mode does not dirty the git worktree
- PATH already prioritizes `~/.local/bin` in both fish and zsh, so wrappers are a viable repo-native way to select the active variant for CLI tools.
- Accept that some apps will update only on next launch; the controller should trigger reloads where easy and otherwise leave the new mode to apply on reopen.
- Keep theme naming consistent so dark/light variants are easy to recognize and switch.
- Add a follow-up repo note in `AGENTS.md` that these app themes are intentionally native/per-app and must stay synced to the shared Cloudflare palette.

## Files to modify

Critical files and paths likely involved:

- `common/.config/nvim/lua/plugins/colorscheme.lua`
- `common/.config/nvim/lua/plugins/lualine.lua`
- likely one or more new nvim palette/helper files under `common/.config/nvim/lua/`
- `common/.config/ghostty/config`
- `macos/home/Library/Application Support/com.mitchellh.ghostty/config`
- likely new Ghostty theme files under `common/.config/ghostty/themes/`
- `common/.config/btop/themes/*.theme`
- `common/.config/lazygit/config.yml` or variant-specific lazygit config files
- `common/.config/lazydocker/config.yml` or variant-specific lazydocker config dirs/files
- `common/.config/tmux/tmux.conf`
- `common/.config/starship.toml` or variant-specific starship config files
- `common/.pi/agent/settings.json`
- new Pi theme files under `common/.pi/agent/themes/`
- new theme controller / wrappers under `common/.local/bin/`
- `linux/home/.config/gtk-3.0/gtk.css`
- `linux/home/.config/gtk-3.0/gtk-dark.css`
- `linux/home/.config/gtk-4.0/gtk.css`
- `linux/home/.config/gtk-4.0/gtk-dark.css`
- `linux/home/.config/gtk-3.0/settings.ini`
- `linux/home/.config/gtk-4.0/settings.ini`
- `linux/home/.config/qt5ct/qt5ct.conf`
- `linux/home/.config/qt6ct/qt6ct.conf`
- `linux/home/.config/qt5ct/colors/*.conf`
- `linux/home/.config/qt6ct/colors/*.conf`
- `linux/home/.config/Kvantum/kvantum.kvconfig`
- likely new Kvantum theme directories under `linux/home/.config/Kvantum/`
- `linux/home/.config/hypr/hyprland.conf`
- `linux/home/.config/hypr/oled-orange.conf` or replacement Cloudflare dark palette file
- likely a new light palette companion under `linux/home/.config/hypr/`
- `linux/home/.config/hypr/scripts/start-hyprpanel.sh`
- `linux/home/.config/hyprpanel/config.json` (replace dashboard `Nvim` shortcut with theme toggle entry)
- `linux/home/.config/hyprpanel/modules.scss`
- likely variant-specific HyprPanel config/CSS files under `linux/home/.config/hyprpanel/`
- `linux/home/.config/rofi/config.rasi`
- replacement Cloudflare theme files under `linux/home/.config/rofi/`
- new `wofi` style files under `linux/home/.config/wofi/`
- `AGENTS.md` (note about keeping native theme implementations synchronized)

## Reuse

Existing patterns/utilities worth reusing:

- Catppuccin dark/light semantic palettes already embedded in:
  - `common/.config/starship.toml`
  - `linux/home/.config/hypr/mocha.conf`
  - `linux/home/.config/hypr/latte.conf`
- Existing Cloudflare/orange direction already present in:
  - `linux/home/.config/hypr/oled-orange.conf`
  - `linux/home/.config/hyprpanel/modules.scss`
  - `linux/home/.config/hyprpanel/config.json` theme color keys
- Existing launcher setup discovered during exploration:
  - `linux/home/.config/hypr/hyprland.conf` sets `$menu = rofi -show drun`
  - `SUPER+SPACE` is bound to `$menu`, so `rofi` is the primary launcher to theme
  - `wofi` is still used in cliphist clipboard picker binds, so it also needs a matching variant
- Existing per-tool theme wiring:
  - nvim already uses `catppuccin/nvim` in `common/.config/nvim/lua/plugins/colorscheme.lua`, which supports in-repo `color_overrides`, `highlight_overrides`, and lualine integration overrides
  - lualine theme selection already lives in `common/.config/nvim/lua/plugins/lualine.lua`
  - tmux already uses `dmmulroy/catppuccin-tmux` in `common/.config/tmux/tmux.conf` with numerous color override knobs in the current config block
  - btop theme files already live in `common/.config/btop/themes/`
  - lazygit/lazydocker already expose `gui.theme` sections in their YAML configs
  - Ghostty already uses `theme = ...` in both Linux/macOS configs
  - Starship already has named palette support in `common/.config/starship.toml`
  - Pi already has a tracked theme selection in `common/.pi/agent/settings.json` and tracked theme assets under `common/.pi/agent/themes/`
  - Qt currently routes through `QT_QPA_PLATFORMTHEME=qt6ct` and `QT_STYLE_OVERRIDE=kvantum` in `linux/home/.config/hypr/hyprland.conf`
  - Kvantum is currently pinned to `catppuccin-mocha-blue` in `linux/home/.config/Kvantum/kvantum.kvconfig`
  - rofi currently points at `linux/home/.config/rofi/catppuccin-default.rasi` from `linux/home/.config/rofi/config.rasi`
- Existing launcher/wrapper prerequisites already in repo:
  - `common/.config/fish/config.fish` prepends `~/.local/bin` to `PATH`
  - `common/.zshrc` also prepends `~/.local/bin` to `PATH`
  - `safe-stow.sh` already deploys non-`.config` home-tree paths from `common/`, so repo-managed wrapper scripts under `common/.local/bin/` will stow cleanly
  - that makes repo-managed wrapper scripts under `common/.local/bin/` a practical way to select theme-specific configs for CLI tools
- Existing target app capabilities discovered during exploration:
  - `lazygit` supports `--use-config-file` / `-ucf`
  - `lazydocker` supports overriding its config directory via `CONFIG_DIR`
  - `lazydocker` docs explicitly note config changes take effect only after closing and reopening the app
  - `btop` supports `--config` and `--themes-dir`, and has historically accepted absolute theme paths in this repo
  - `Ghostty` supports custom theme files, light/dark paired `theme = light:...,dark:...`, and optional `config-file` includes
  - `starship` supports `STARSHIP_CONFIG`
  - `pi` supports `--theme <path>` for loading custom theme files/directories
  - installed system Kvantum themes under `/usr/share/Kvantum/` provide both dark and light Catppuccin theme structure that can be used as a reference when creating in-repo Cloudflare variants
- Existing menu hook to replace:
  - `linux/home/.config/hyprpanel/config.json` currently defines `menus.dashboard.shortcuts.left.shortcut2.*` as the `Nvim` Ghostty launcher
- Existing GTK mode behavior:
  - `linux/home/.config/gtk-3.0/settings.ini` and `linux/home/.config/gtk-4.0/settings.ini` both currently force dark mode with `gtk-application-prefer-dark-theme=1`
  - GTK dark/light CSS files already exist separately by filename, even though the current contents are identical

## Steps

- [x] Confirm the intended Cloudflare palette direction and dark/light behavior.
- [x] Inventory each target app’s current theme mechanism and whether it supports variant switching natively.
- [x] Define the final semantic palette for dark + light variants.
- [x] Implement a shared theme-mode controller/state approach (preferably under `~/.local/state/theme/`) that avoids rewriting tracked stow-managed files on every toggle.
- [x] Replace the HyprPanel `Nvim` dashboard shortcut with a theme toggle command that calls the controller.
- [x] Add theme-aware wrappers / runtime overlays for apps that already support alternate config paths (`pi`, `btop`, `lazygit`, `lazydocker`, `rofi`, `wofi`, `starship`, and the HyprPanel launch flow).
- [x] Update nvim, tmux, Ghostty, GTK, Qt/Kvantum, Hyprland, HyprPanel, `rofi`, and `wofi` to read/apply the correct Cloudflare dark/light variant from the shared mode.
- [x] Add repo documentation noting that the theme is implemented via native per-app configs that must stay synchronized.
- [x] Verify visual consistency across terminal/editor/system surfaces.

## Verification

- Neovim: launch `nvim`, confirm colorscheme + lualine match in dark and light variants.
- Ghostty: open Ghostty on Linux/macOS, confirm theme selection and readability.
- Pi: launch `pi`, confirm the TUI theme resolves to the Cloudflare variant matching the active mode.
- btop: run `btop`, verify both theme files render correctly.
- lazygit / lazydocker: launch both and check borders, selection, accent, and status colors.
- tmux: reload/restart tmux, verify status bar + window states remain legible.
- starship: open a fresh shell and confirm prompt palette against both terminal variants.
- GTK: verify GTK3/GTK4 apps in both dark/light preference modes.
- Qt / Kvantum: verify one or more Qt apps pick up the correct Cloudflare dark/light variant.
- Hyprland: reload config and confirm border/accent colors switch correctly.
- HyprPanel: verify the dashboard shortcut formerly labeled `Nvim` becomes a theme toggle entry and successfully switches the active mode.
- rofi: trigger `SUPER+SPACE` and confirm the launcher theme matches the active Cloudflare variant.
- wofi: trigger the clipboard picker flows and confirm the popup styling matches the active Cloudflare variant.
- Running app behavior: confirm which targets hot-reload immediately (`tmux`, Hyprland, potentially Ghostty/new prompts) versus which ones require reopening (`lazydocker`, likely other TUIs) and document that behavior clearly.
