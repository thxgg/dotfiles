# Catppuccin Latte/Mocha Theme Plan

## Context

Replace the current Cloudflare/orange-flavored light/dark theme setup with Catppuccin Latte for light mode and Catppuccin Mocha for dark mode, using Catppuccin Lavender as the shared accent color. The change should cover the existing theme-mode system and the requested apps: Ghostty, btop, Starship, lazydocker, lazygit, Neovim, Helium/NightTab, Slack, tmux, and Pi.

Initial discovery:

- The repo already has a cross-platform `theme-mode` controller that persists `dark`/`light` in `~/.local/state/theme/mode` and reloads tmux/Hyprland/HyprPanel where possible.
- Most requested terminal/TUI apps already have wrappers in `common/.local/bin/` that select mode-specific config files at launch.
- Current app themes are named/implemented as Cloudflare variants, though some Catppuccin assets already exist, especially btop's `catppuccin_latte.theme` and `catppuccin_mocha.theme`.
- Neovim already uses `catppuccin/nvim`, but `common/.config/nvim/lua/user/theme.lua` currently overrides the palette with custom Cloudflare colors.
- Helium browser, NightTab extension, and Slack theming do not currently appear to have tracked theme config files in this repo.
- macOS is the first browser/Slack target; Linux browser/Slack support can follow later.
- Catppuccin upstream has official/community ports for the requested external surfaces:
  - `catppuccin/slack` provides Slack theme strings, but their published strings use Mauve by default; adapt those strings to Lavender.
  - `catppuccin/nighttab` documents NightTab Catppuccin theme creation and supports any Catppuccin accent, including Lavender.
  - `catppuccin/chrome` publishes release zips for `catppuccin-chrome-latte-lavender.zip` and `catppuccin-chrome-mocha-lavender.zip`, which should work as the starting point for Helium because it is Chromium-based.
- Current working tree has unrelated local modifications in `common/.config/nvim/lazy-lock.json` and `common/.pi/agent/models.json`; implementation should avoid touching them unless explicitly required.

## Approach

Use the existing `theme-mode` architecture instead of inventing a new switcher, but change macOS behavior to resolve from the system appearance automatically. Keep manual `set light` / `set dark` for testing and Linux compatibility, and add/allow `auto` so macOS can derive the active mode via `defaults read -g AppleInterfaceStyle` (`Dark` => `dark`, missing/unset => `light`). Wrappers will call the resolver at launch, and a macOS LaunchAgent will run a small apply/check loop so long-running tmux and generated runtime files update after the system appearance changes.

Apply official Catppuccin Latte/Mocha palettes and standard Lavender accents:

- Latte Lavender: `#7287fd`
- Mocha Lavender: `#b4befe`

For apps with built-in Catppuccin support or existing Catppuccin assets, prefer those and adjust accent-bearing fields to Lavender. For Helium/NightTab/Slack on macOS, use upstream Catppuccin assets where possible, with clear limitations around browser extension and Slack settings that are not normal dotfiles.

Recommended macOS external-app handling:

- Helium browser chrome: add a helper that downloads/unpacks the Catppuccin Chrome Latte Lavender and Mocha Lavender release zips into `~/.local/share/catppuccin-chrome/`, then applies the matching unpacked theme to Helium where feasible. If Chromium/Helium does not expose safe live theme switching, the helper should at least prepare the unpacked themes and document the one-time `chrome://extensions` / `Load unpacked` step.
- NightTab: `common/.local/bin/catppuccin-nighttab-lavender` prints/copies a console snippet based on `catppuccin/nighttab` that updates existing `Catppuccin Latte/Mocha Sapphire` custom themes to `Catppuccin Latte/Mocha Lavender` and switches the active accent to Lavender after the one-time console import.
- Slack: use Slack's supported custom theme strings, adapted to Lavender. Latte: `#EFF1F5,#F8F8FA,#7287FD,#EFF1F5,#DCE0E8,#4C4F69,#7287FD,#E64553,#EFF1F5,#4C4F69`; Mocha: `#1E1E2E,#F8F8FA,#B4BEFE,#1E1E2E,#11111B,#CDD6F4,#B4BEFE,#EBA0AC,#1E1E2E,#CDD6F4`. Prefer documenting/copying these strings over brittle Slack internals unless a safe macOS Slack settings file is found during implementation.

## Files to modify

Expected critical files:

- `common/.local/bin/theme-mode`
- `common/.local/bin/theme-lib.sh`
- `common/.local/bin/btop`
- `common/.local/bin/lazydocker`
- `common/.local/bin/lazygit`
- `common/.local/bin/starship`
- `common/.local/bin/pi`
- `common/.config/ghostty/config`
- `common/.config/ghostty/themes/*`
- `macos/home/Library/Application Support/com.mitchellh.ghostty/config`
- `macos/home/Library/Application Support/com.mitchellh.ghostty/themes/*`
- `common/.config/btop/btop.conf`
- `common/.config/btop/themes/catppuccin_latte.theme`
- `common/.config/btop/themes/catppuccin_mocha.theme`
- `common/.config/starship-light.toml`
- `common/.config/starship-dark.toml`
- `common/.config/starship.toml`
- `common/.config/lazygit/theme-light.yml`
- `common/.config/lazygit/theme-dark.yml`
- `common/.config/lazydocker/light/config.yml`
- `common/.config/lazydocker/dark/config.yml`
- `common/.config/nvim/lua/user/theme.lua`
- `common/.config/nvim/lua/plugins/colorscheme.lua`
- `common/.config/nvim/lua/plugins/lualine.lua`
- `common/.config/tmux/tmux.conf`
- `common/.pi/agent/themes/catppuccin-latte.json`
- `common/.pi/agent/themes/catppuccin-mocha.json`
- likely new helper(s) under `common/.local/bin/` for Catppuccin browser/NightTab/Slack setup or copying theme strings
- likely new macOS LaunchAgent under `macos/home/Library/LaunchAgents/` for auto-apply on appearance changes
- `macos/setup.sh` to load the LaunchAgent idempotently, if a LaunchAgent is added
- `AGENTS.md` and/or theme docs to reflect Catppuccin synchronization expectations

## Reuse

- `common/.local/bin/theme-mode`: existing `get/set/toggle/apply` controller and reload hooks.
- `common/.local/bin/theme-lib.sh`: shared mode/state helpers used by wrappers; extend with macOS system appearance detection.
- `common/.local/bin/{btop,lazydocker,lazygit,starship}`: existing launch-time variant selection.
- `common/.config/btop/themes/catppuccin_latte.theme` and `common/.config/btop/themes/catppuccin_mocha.theme`: existing Catppuccin assets.
- `common/.config/nvim/lua/plugins/colorscheme.lua`: already loads `catppuccin/nvim` and switches Latte/Mocha by mode.
- `common/.config/tmux/tmux.conf`: already uses `dmmulroy/catppuccin-tmux` and switches `latte`/`mocha` by mode.
- Ghostty already supports paired `theme = light:...,dark:...` in shared and macOS configs.
- Catppuccin upstream resources discovered via GitHub:
  - `catppuccin/slack` for supported Slack custom theme strings.
  - `catppuccin/nighttab` for NightTab theme creation using `setTheme("<flavour>", "<accent>")`.
  - `catppuccin/chrome` release assets for Latte/Mocha Lavender Chromium themes.

## Steps

- [x] Confirm requirements for Helium profile/NightTab and Slack theming: macOS first, auto from system light/dark, Slack supported theme level only.
- [x] Define the exact Catppuccin Latte/Mocha role mapping with Lavender as the accent.
- [x] Extend `theme-mode`/`theme-lib.sh` so macOS can resolve `auto` from system appearance and reload only when the resolved mode changes.
- [x] Add a macOS LaunchAgent and setup hook so `theme-mode --quiet apply` runs automatically after system appearance changes.
- [x] Update wrappers/config names so launch-time theme selection points to Catppuccin assets rather than Cloudflare assets.
- [x] Replace Ghostty Cloudflare themes with Catppuccin Latte/Mocha theme files and update shared/macOS config references.
- [x] Point btop at `catppuccin_latte.theme`/`catppuccin_mocha.theme` and make Lavender the primary highlight/selected/accent color.
- [x] Replace Starship palettes with Catppuccin Latte/Mocha, using Lavender for prompt accents currently using orange/peach.
- [x] Replace lazygit/lazydocker colors with Catppuccin Latte/Mocha + Lavender active border/selection accents.
- [x] Simplify Neovim custom overrides so it uses true Catppuccin Latte/Mocha with Lavender accent highlights rather than custom Cloudflare colors.
- [x] Update tmux Catppuccin settings to remove Cloudflare overrides and use Latte/Mocha Lavender-focused status/window colors.
- [x] Update Pi wrapper/theme files to use Catppuccin Latte/Mocha with Lavender accents.
- [x] Add macOS Helium helper/setup docs for Catppuccin Chrome Latte/Mocha Lavender assets; automate safe parts and document any required one-time unpacked-theme install.
- [x] Add macOS NightTab helper/setup docs to create Latte/Mocha Lavender custom themes using the upstream NightTab Catppuccin approach; document any extension UI/manual selection limitation.
- [x] Add Slack Latte/Mocha Lavender strings and a small helper/doc path for copying/importing the matching string; avoid brittle Slack internals unless a safe supported config file is found.
- [x] Update documentation/comments that currently refer to Cloudflare theming.

## Verification

- On macOS, toggle System Settings appearance between Light and Dark; confirm `theme-mode get` resolves `light`/`dark` correctly in auto mode.
- Confirm the LaunchAgent is loaded and only reapplies when the resolved system mode changes.
- Run `theme-mode set light`, `theme-mode set dark`, and `theme-mode set auto` for override/auto behavior; confirm tmux reloads.
- Launch Ghostty in both OS-specific configs and confirm Latte/Mocha with Lavender cursor/selection/accent.
- Launch `btop`, `starship` via a new shell, `lazygit`, and `lazydocker` in both modes.
- Launch `nvim` in both modes and confirm `:colorscheme` is `catppuccin-latte`/`catppuccin-mocha`, with lualine matching.
- Reload/restart tmux and confirm status bar/window highlights are Lavender and readable.
- Launch `pi` in both modes and confirm it resolves the Catppuccin Latte/Mocha Lavender runtime theme.
- Verify Helium browser chrome can use the prepared Catppuccin Chrome Latte/Mocha Lavender themes; record any unavoidable one-time manual step.
- Verify NightTab has Catppuccin Latte Lavender, Mocha Lavender, and Catppuccin Lavender System custom themes available; confirm the selected System theme follows the browser/system light-dark preference after refresh.
- Verify Slack accepts the Lavender-adapted Catppuccin theme strings via Preferences → Themes → Import theme.
