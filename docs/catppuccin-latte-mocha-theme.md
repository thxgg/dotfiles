# Static theme assets

The repository keeps Catppuccin Latte/Mocha assets with Lavender accents:

- Latte Lavender: `#7287fd`
- Mocha Lavender: `#b4befe`

There is no shared theme controller. Theme-only wrappers, setup helpers, shared
state readers, and the HyprPanel theme-toggle action have been removed.
Applications run directly through their installed executables.

## Select a theme

Use each application's settings or native configuration:

- Ghostty uses Catppuccin Mocha with dark window chrome.
- Herdr uses its dark `catppuccin` theme with native appearance switching disabled.
- OpenCode uses its `catppuccin` theme in dark mode.
- Fish uses static Mocha colors with Lavender accents.
- Neovim uses a static Mocha default in `common/.config/nvim/lua/user/theme.lua`.
- btop selects `catppuccin_mocha` by name on both platforms and keeps both theme files.
- Starship uses Mocha in `common/.config/starship.toml`. Light/dark alternatives remain available.
- lazygit defaults to Mocha and keeps separate theme files. Use its native config-file option to select one.
- lazydocker defaults to Mocha and keeps light/dark configuration directories. Use its native `CONFIG_DIR` option.
- HyprPanel uses `config.json` and `modules.scss`. Light alternatives remain available.
- GTK and Kvantum use their native settings. No script rewrites GTK preferences or generates Kvantum links.
- Pi keeps its theme files; select them through `/settings`.
- Browser themes use Mocha with Lavender accents under `common/.local/share/browser-themes/`. The existing `soft-lavender` directory names are preserved. Reload each unpacked theme as described in its README.

Linux-only selections are unchanged. GTK, Kvantum, Hyprland, and Rofi still
select Latte/light. HyprPanel and Wofi already use dark colors. Pi's active
selection and OS-wide appearance remain machine-local and are not changed.

The Linux Amp web-app launcher is unrelated to theme automation and remains available for remote Orbs.

## Existing installations

Remove only deployed symlinks that point to the retired repository scripts.
Do not remove unrelated executables with the same names. Open a new shell after
removing wrappers. Fish sets process-global Mocha colors at startup; it does
not write universal theme variables.

Old `~/.local/state/theme` files are no longer read. Existing GTK/Kvantum settings
and browser assets are left intact. No appearance or application state migration
runs during setup or updates.

Before deploying the earlier wallpaper-service removal on Linux, disable the
installed service, remove its installed unit/link, then reload the user manager:

```sh
systemctl --user disable --now nautilus-wallpaper-sync.service
systemctl --user daemon-reload
```

Visual results still require checks in the target applications on each OS.
