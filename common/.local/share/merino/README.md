# Merino theme ports

Source: Rex Beta 0.1.0 (1642), entries `merino-dark` and `merino-light` in
`SuperUI_SuperDesignTokens.bundle/Contents/Resources/themes.json`.

`palette.json` records the exact sRGB terminal colors and selected UI tokens.
Ports are static files, not runtime-generated configuration. No global switcher,
background watcher, or cross-application settings writer is installed.

## Coverage and selection

Paths below are relative to `$HOME` after deployment. Edit the corresponding
repository files, not separate live copies.

| Application | Selection | Light variant |
| --- | --- | --- |
| Ghostty | Native system light/dark pair | Automatic |
| Neovim and Lualine | `colorscheme merino`, uses `background` | `:set background=light` (dark to revert) |
| btop | `color_theme = "merino_dark"` | `merino_light` in btop's theme menu or config |
| Starship | `.config/starship.toml` is Merino Dark | Set `STARSHIP_CONFIG` to `~/.config/starship-light.toml` |
| Lazygit | Shared and macOS configs use Dark | Pass `--use-config-file` with the main config and `~/.config/lazygit/theme-light.yml`, comma-separated, in that order |
| Lazydocker | Shared and macOS configs use Dark | Copy the theme section from `.config/lazydocker/light/config.yml` into the main repository config |
| Fish | `.config/fish/conf.d/colors.fish` selects Dark | Change its local `merino_variant` to `light` |
| Herdr | Native terminal appearance selection with full light/dark overrides | Automatic |
| OpenCode CLI | `merino`, native `system` mode | Automatic, or select a fixed mode |
| Pi | `merino-dark.json` and `merino-light.json` | Select through Pi's native settings |
| Chrome / Helium | Unpacked themes in `.local/share/browser-themes/merino-dark` and `merino-light` | Load the desired directory in the browser's extension developer mode |
| Hyprland | `merino-dark` in both Lua and legacy config | Select `merino-light` in the corresponding config |
| Rofi | `@theme "merino-dark"` | `@theme "merino-light"` |
| Wofi | Existing `style-dark.css` now uses Merino | `style-light.css` |
| Hyprlock | Dark colors in the existing shared layout and fallback backgrounds | No new light lock layout |

Pi settings and browser profiles are machine-local. The ports do not change them.
For Pi, select the pair `merino-light/merino-dark` in native settings or launch
`pi --use-theme merino-light/merino-dark`. Run `/reload` after deployment if needed.
The existing verbosity lab remains a fixed Catppuccin fixture.

## Implementation notes

- Neovim keeps the pinned Catppuccin plugin as a highlight engine. Every base
  palette role is overridden. This retains LSP, Treesitter, completion, and
  plugin integrations rather than replacing them with an incomplete colorscheme.
  Some adapter keys keep Catppuccin names; their values are Merino.
- Syntax roles not defined by Rex map to its ANSI colors: strings use green,
  functions blue, keywords purple, and numbers yellow.
- UI surfaces and borders use Rex's sRGB UI tokens. Selection rows use a subtle
  surface or accent container; terminal text selection retains Rex's inversion.
- Application rendering and extra generated colors can differ from Rex.
  The Display P3 and harmonious 256-color palettes are not copied.
- Existing named Catppuccin theme files remain available as fallbacks. Generic
  active files such as Starship and Lazygit now contain Merino values.

## Not ported in this pass

- GTK and Kvantum require complete installable theme packages. Their existing
  Catppuccin packages and selections remain unchanged. Inactive Qt5ct/Qt6ct
  Catppuccin palettes also remain unchanged; custom palettes are disabled.
- Handy's private Catppuccin build requires source patching, a Linux rebuild,
  selection, and live overlay checks. Its patch and launcher are unchanged.
- HyprPanel's intentional black-and-white OLED styling is preserved.
- Browser themes are supplied but not installed into profiles.
- Pi theme files are supplied but machine-local settings are not rewritten.

## Apply and check

Existing Stow links can expose edits immediately. New theme files may need
deployment if their parent directory is not already linked. When deployment
is requested, use `safe-stow.sh` with the smallest applicable scope. Restart
or reload each application with its native controls. No deployment or Linux
desktop reload is part of the theme port.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/common-config.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/merino-themes.test.py
```

Use Python 3.11+ for the TOML parser checks (older Python skips them). To check
the real Neovim highlight engine without loading your startup files or fetching
plugins, pass `MERINO_CATPPUCCIN_PATH` pointing to an existing Catppuccin checkout.
Its compiled cache is written only inside a temporary test home.

These checks do not prove visual rendering on a live Linux desktop.
