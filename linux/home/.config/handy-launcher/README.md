# Handy on Hyprland

Handy 0.9.8 forces `WEBKIT_DISABLE_DMABUF_RENDERER=1`. With WebKitGTK 2.54,
this can leave only the animated pink dot visible in the recording overlay.
See https://github.com/cjpais/Handy/issues/2166.

`launch` compiles a small `setenv` shim into
`${XDG_CACHE_HOME:-$HOME/.cache}/handy-launcher/` on first use. The source hash
selects the cached library. Build output is published atomically; a failed
build does not launch Handy. The launcher sets the renderer variable to `0`
and prevents Handy from overwriting it. Other environment writes pass through.
`LD_PRELOAD` applies only to Handy and its children, not the desktop session.
No binary or app settings are tracked.

The launcher clears inherited `APPIMAGE`, `APPDIR`, and `OWD` variables. Without
this, Tauri can mistake the parent terminal/agent AppImage for Handy and write
an incorrect autostart command.

## Requirements

- `handy-bin` in `linux/packages/core-apps.txt`
- `wtype` in `linux/packages/desktop-hyprland.txt`
- `cc` from the existing `base-devel` profile
- GNU coreutils, Bash, and glibc

The dynamic loader cannot load this library from a cache path containing spaces
or colons. The launcher rejects those paths before building.

## Deployment

From the repository root:

```sh
./safe-stow.sh --only-config handy-launcher,hypr
```

The repository's `linux/home/.local/share/applications/Handy.desktop` overrides
the package launcher during full deployment. To install only this desktop entry
without deploying unrelated files, back up any existing user `Handy.desktop`,
then run:

```sh
desktop-file-install --dir="$HOME/.local/share/applications" \
  linux/home/.local/share/applications/Handy.desktop
update-desktop-database "$HOME/.local/share/applications"
```

Hyprland starts `launch --start-hidden` once per session. Super+O runs
`launch --toggle-transcription`. Keep Handy's built-in **Launch at Login** off:
Hyprland owns autostart. If that option was enabled, turn it off in Handy first
(or quit Handy, back up its `settings_store.json`, set `autostart_enabled` to
`false`, and restart). Do not track or deploy Handy's state directory: it may
contain provider credentials, recordings, and history.

The application-menu entry also uses the wrapper. A plain `/usr/bin/handy`
launch bypasses it. Fully quit an existing instance before changing launch
methods; a second invocation only talks to the existing process.

## Disable or remove

For a one-off launch without the workaround, fully quit Handy, then run:

```sh
HANDY_DMABUF_WORKAROUND=0 ~/.config/handy-launcher/launch
```

The upstream renderer restriction prevented crashes on some GPUs. Use this
escape hatch if re-enabling DMA-BUF makes Handy unstable. Recheck the workaround
when Handy or WebKitGTK changes; remove it when upstream fixes the issue.

For permanent removal, restore ordinary Handy commands in both Hyprland files,
remove the user desktop override, and remove the deployed launcher component.
The cache can be deleted while Handy is stopped.

## Validation

```sh
shellcheck linux/home/.config/handy-launcher/launch
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-handy-launcher.test.py
```

Tests use temporary homes, a mock Handy executable, and a native C probe. They
check environment isolation, argument forwarding, cache reuse, compile failure,
opt-out, desktop-entry parsing, and both Hyprland entries. They do not open a
microphone, start Handy, or use the desktop session bus.

Live checks: launch Handy through the wrapper, confirm WebKit child processes
retain `WEBKIT_DISABLE_DMABUF_RENDERER=0`, and test the overlay over multiple
recordings. The user confirmed the temporary shim fixed the flicker on Arch,
Hyprland 0.56.2, WebKitGTK 2.54.1, and a Radeon RX 7900 XT.
