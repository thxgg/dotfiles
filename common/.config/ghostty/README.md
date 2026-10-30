# Ghostty themes

The active configuration selects Merino Light or Merino Dark to match the system
appearance. These are static ports of the themes bundled with Rex Beta 0.1.0,
build 1642. The Catppuccin themes remain available.

## Select Merino

In this directory's `config`, replace the existing `theme` and `window-theme`
lines with a fixed variant. On macOS, also update those lines in
`macos/home/Library/Application Support/com.mitchellh.ghostty/config`.
Ghostty loads that file after the shared config, so its settings take precedence.
Both configurations use the themes in the shared `~/.config/ghostty/themes` directory.

```ini
theme = Merino Dark
window-theme = auto
```

Use `theme = Merino Light` for the light variant. To follow the system appearance
with Ghostty's native theme selection instead:

```ini
theme = light:Merino Light,dark:Merino Dark
window-theme = auto
```

`window-theme = auto` lets the window chrome follow the selected appearance
instead of forcing dark chrome for the light theme. Other applications are not
changed.

When deployment is wanted, run from the repository root:

```sh
./safe-stow.sh --only-config ghostty
```

Then reload Ghostty's configuration.

## Port source and limits

The source is the installed Rex bundle:

```text
/Applications/Rex Beta.app/Contents/Resources/SuperUI_SuperDesignTokens.bundle/Contents/Resources/themes.json
```

Entries `merino-dark` and `merino-light` supply these values:

- `source.ansi[0..15]` maps directly to Ghostty's `palette` entries.
- `source.background` and `source.foreground` map directly.
- `source.cursor` and `source.cursorText` map to `cursor-color` and `cursor-text`.
- `source.selectionBackground` and `source.selectionForeground` map directly.
- `cssVariables["--super-border"]` maps to `split-divider-color`.

The port uses the supplied sRGB colors, not Rex's separate Display P3 values.
Keep Ghostty's default `window-colorspace = srgb` for these files. Colors 16–255
remain Ghostty's standard palette; Rex's generated harmonious extended palette
is not copied. Rex-specific sidebar, controls, and material effects are not
part of a Ghostty terminal theme.

## Validation

Validate each file without deploying or opening a terminal window:

```sh
ghostty +validate-config --config-file="$PWD/common/.config/ghostty/themes/Merino Dark"
ghostty +validate-config --config-file="$PWD/common/.config/ghostty/themes/Merino Light"
```

On macOS, use `/Applications/Ghostty.app/Contents/MacOS/ghostty` if `ghostty` is
not on `PATH`. Parser validation does not verify live rendering.
