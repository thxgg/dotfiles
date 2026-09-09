# Soft Lavender

A light Chrome theme based on sampled screenshot colors. This is not an
official Mitchell Hashimoto theme.

| Region | Hex | RGB |
| --- | --- | --- |
| Frame | #E6D6F4 | 230, 214, 244 |
| Toolbar / active tab | #FEF4FE | 254, 244, 254 |
| Address field | #ECE0EF | 236, 224, 239 |

Text, icon, link, inactive-frame, and new-tab colors are reconstruction choices.
Chromium may adjust rendered colors for contrast.

## Install or update

1. Open `chrome://extensions/` in Chrome.
2. Enable Developer mode and select Load unpacked.
3. Select this directory, which contains manifest.json.
4. Confirm Soft Lavender in `chrome://settings/appearance`.

Keep the directory in place. Load it again after updates to rebuild the theme
cache. To remove it, select Use Classic in appearance settings or install
another theme.

Use `../soft-lavender-helium` for Helium. Do not share one unpacked directory
between browsers: each browser writes its own `Cached Theme.pak`. Git ignores
these generated caches.

The theme has no scripts, permissions, or network access. It is independent
of the repository's Catppuccin themes and automatic theme selection.
