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

## Private Catppuccin build

`catppuccin-v0.9.8.patch` targets Handy commit
`14f6f0d31cb22a4268acfbddba3052820fd0a06e` (v0.9.8). It changes the shared
palette to Latte/Mocha with Lavender accents, the overlay's neutral colors,
fixed pink UI icons, and audio progress. Primary buttons use a dark foreground
on Lavender rather than low-contrast white. The existing System/Light/Dark
selector continues to work. This is a private local customization, not an
official Handy release. Do not redistribute it using upstream's branding.

To rebuild, supply clean source repositories containing the pinned commits:

```sh
~/.config/handy-launcher/build-catppuccin /path/to/Handy /path/to/SPIRV-Headers
```

In addition to the launch requirements, the builder needs Bun, Rust toolchain
`1.97.1`, CMake, Clang, shaderc (`glslc`), Vulkan headers, GTK/WebKit development
files, and `patch`. It uses four build jobs. SPIRV-Headers commit
`b824a462d4256d720bebb40e78b9eb8f78bbb305` is installed under the build directory,
not `/usr`. The ONNX runtime comes from the installed `handy-bin` 0.9.8 package;
its checksum is checked before building. Reassess this input when upgrading.
Bun and Cargo use frozen/locked dependencies. Sources and compilation output
stay in `~/.cache/handy-catppuccin/`; binaries and resources go under
`~/.local/share/handy-catppuccin/0.9.8-<patch-hash>/`.

The initial private build passed the frontend build, lint, and formatting
checks, the native release build, and `cargo clippy --release --locked` (with
14 upstream warnings). A browser check confirmed the compiled light/dark
palette values, and the native settings window rendered the Mocha/Lavender
palette correctly. The user confirmed that the custom build works on this
machine after switching to it.

The builder does not select the result or restart Handy. After testing, the
`current` symlink selects a private build. The launcher uses it only when its
binary exists, and otherwise falls back to the package. It disables Handy's
self-updater for the private build to prevent losing the palette. App settings,
models, and history remain in the existing Handy data directory; never run
both variants concurrently. Back up settings before switching.

To return to the package, fully quit Handy and run:

```sh
HANDY_USE_PACKAGED=1 ~/.config/handy-launcher/launch
```

Remove only the `~/.local/share/handy-catppuccin/current` symlink to make this
fallback permanent. Keep the renderer workaround for either build.

## Required update procedure

**Rebuild the private Catppuccin variant whenever Handy is updated.** An AUR
update changes `/usr/bin/handy`, not the private binary selected by `current`.
Do not report the active application as updated until the rebuilt version is
selected and checked. The private build's self-updater must remain disabled.

1. Record the current symlink target for rollback. Back up Handy's settings
   while the app is stopped; keep this backup private and outside Git.
2. Review the new upstream release and refresh `build-catppuccin`: update the
   Handy commit, version string, and patch filename. Review Rust, SPIRV-Headers,
   and native library requirements. Verify the installed package's ONNX runtime
   matches the new release before updating its checksum; do not bypass the
   checksum check. Update the documented pins in this file.
3. Rebase the versioned Catppuccin patch onto that release. Check both themes,
   overlay colors, and foreground contrast. Require a clean patch application;
   do not accept rejected hunks or silently omit parts of the theme.
4. Rerun `build-catppuccin /path/to/Handy /path/to/SPIRV-Headers`. Keep the old
   installation intact. The builder refuses an existing destination: if the
   version and patch are unchanged but a rebuild is required, use a new build
   suffix in its `version` value rather than deleting the active build.
5. Run the launcher tests and ShellCheck below, the frontend build/lint/format
   checks, and native release/Clippy checks. Report upstream warnings or checks
   that could not run. Reassess the DMA-BUF workaround against the new release
   and WebKitGTK; remove it only after verifying an upstream fix locally.
6. Wait until Handy is idle, fully quit it, and point `current` at the new
   versioned directory. Start it through `~/.config/handy-launcher/launch`.
   Confirm the running executable and version, Super+O, dictation/paste, the
   overlay across repeated recordings, and the Light/Dark/System themes.
7. If a check fails, quit Handy and restore the previous symlink target. Keep
   Hyprland as the only autostart owner. Commit the reviewed pins, patch, and
   documentation; do not commit build output, app state, or recordings.

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
shellcheck linux/home/.config/handy-launcher/{launch,build-catppuccin}
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
