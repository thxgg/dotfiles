# Soft Lavender for Helium

A separate adaptation of Soft Lavender for Helium 0.16.5.

Version 1.2 removes the toolbar image workaround. The shared frame and toolbar
use the pale toolbar color. Inactive tabs retain lavender coloring. This favors
selected-tab contrast over a lavender background across the entire tab strip.

Color inputs:

- Frame: #E6D6F4
- Toolbar: #FEF4FE
- Address field: #ECE0EF

Helium and Chromium can adjust rendered colors. Tab shapes differ from Chrome.
The previous image workaround also painted the selected tab lavender, which
removed its contrast against the tab strip.

## Install or update

In Helium, open chrome://extensions/, enable Developer mode, select Load
unpacked, and choose this directory. Re-load it after updates to rebuild the
cached theme. Confirm Soft Lavender for Helium in chrome://settings/appearance.
Keep this directory in place. This does not change Chrome's theme.

The Chrome variant is in ../soft-lavender. Do not share an unpacked theme
directory between browsers: each browser writes its own Cached Theme.pak.

To remove, select Use Classic in appearance settings or install another theme.
This theme has no scripts, permissions, or network access.

## Validation

Version 1.2 passes JSON and RGB range checks. The running browser needs a theme
reload; its current appearance has not been verified after this change.
