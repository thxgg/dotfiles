# Recording clipboard and notifications

Stopping a recording waits for the recorder to exit, then copies a `text/uri-list`
file reference with `wl-copy`. Applications that accept file paste can use this
reference. It does not put the video bytes on the clipboard. File paste support
varies by application; this is not the macOS pasteboard.

The notification provides **Copy File**, **Copy Path**, **Play**, and
**Open Directory**. Copy Path replaces the clipboard with the plain file path.
Only one representation is selected at a time. Every action keeps the original
recording path, even after a new recording starts. Clipboard failures do not
remove the saved recording.

Required tools include `wf-recorder`, `wl-clipboard`, Python 3, and `libnotify`.
The panel launcher requires the private session `XDG_RUNTIME_DIR`. If its
version-specific compatibility patches fail, it starts the unmodified upstream
panel and warns that custom workspace/recording actions may be unavailable.
The recording helper can still be called directly.

Portable tests:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-recording.test.py
```

On Linux, record a short video, stop it, and test file paste in a file manager
and Copy Path in a text editor. Repeat after starting another recording to check
that the earlier notification still opens the original file.

# Fullscreen World of Warcraft bar visibility

`start-hyprpanel.sh` injects `hyprpanel-bar-visibility.js` into its private runtime.
It replaces the upstream auto-hide initialization with one event-driven controller.
When fullscreen WoW occupies a monitor's active workspace, the controller calls
GTK `set_visible(false)` on that monitor's bar. This unmaps the layer surface and
its input region instead of relying on Hyprland's fullscreen opacity fade.

The controller matches `initialTitle == "World of Warcraft"` and Hyprland's
internal fullscreen value `2`. Maximized windows do not match. An open special
workspace takes precedence over the regular workspace below it. Leaving the
workspace, exiting fullscreen, moving the game, or closing it restores only bars
that the controller hid, subject to HyprPanel's manual visibility preference.
Other monitors are unchanged. The existing `bar.autoHide` modes remain available;
WoW hiding also applies when that option is `never`.

Compositor events trigger coalesced asynchronous state queries. Startup and bar
recreation also trigger a check. There is no polling or separate daemon. Stale
query results are discarded, and failed queries retain the current visibility
until the next event. Shutdown removes subscriptions. This patch shares the
launcher's version checks and unmodified-upstream fallback; a fallback warning
means the WoW input fix is not active.

Run `PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-panel-launcher.test.py` for the
mocked lifecycle checks. After an authorized panel restart, verify that
`hyprpanel isWindowVisible bar-0` returns `false` while fullscreen WoW is on
monitor 0's active workspace. Its `bar-0` surface should leave `hyprctl -j layers`
after any fade completes. Test clicks at the old bar position in-game, workspace
switching (including empty and special workspaces), fullscreen exit, game close,
and independent behavior on the second monitor. Do not use opacity alone as proof.

# Wallpaper daemon lifecycle

The `swww` wrappers support the installed `awww` replacement. HyprPanel waits for
its daemon launch command to finish. The no-argument `swww-daemon` wrapper therefore
starts the daemon with `nohup`, redirects all standard streams, and returns only
when the matching client's `query` succeeds. The daemon does not keep HyprPanel's
subprocess pipes open. A per-display lock prevents duplicate starts, and panel
restarts reuse a responsive daemon. Explicit arguments such as `--help` run directly.

Logs are stored in `$XDG_RUNTIME_DIR/hyprpanel-wallpaper-<display>.log`. Startup
failure returns a nonzero status and stops only the process that the wrapper
started. Wallpaper selection remains in HyprPanel; this does not add a theme
controller or deploy a personal background symlink.

Run `PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-panel-launcher.test.py` for
isolated daemon startup, reuse, argument forwarding, and failure checks. On Linux,
check a cold daemon start and panel restart with `awww query` (or `swww query`).
The same daemon should survive the panel restart and retain the selected image.

# Network icon recovery

`start-hyprpanel.sh` patches the generated network helper in the private session
runtime. It watches wired and Wi-Fi device changes, drops old subscriptions, and
uses symbolic fallback icons when a device or icon name is absent. Unknown
primary connections show an offline icon. It does not poll or restart the panel.
The patch requires each original target to occur exactly once. A package update
that changes these targets causes the launcher to warn and use unmodified
HyprPanel, as with the other compatibility patches.

Run `PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-panel-launcher.test.py`.
The lifecycle checks use Node.js and mock signals. On Linux, restart the panel
and check Ethernet/Wi-Fi switching and reconnects separately. Do not disconnect
a working network merely to run the offline suite.

# Teams PWA tray item

`teams-tray.py` publishes a real StatusNotifierItem beside Slack and the other
tray apps. `start-hyprpanel.sh` starts the helper. A session lock prevents duplicate
helpers. It reconnects when HyprPanel restarts.

`teams-unread.py` reads the Teams PWA window title through `hyprctl clients -j`.
The helper checks it every two seconds:

- Positive `(N)` prefix: monochrome Teams logo with a red-pink unread dot.
- No count: Teams logo without a dot.
- Failed query: keep the previous state until a query succeeds.
- No Teams PWA window: disconnect the tray item. Reconnect when Teams opens.

Click the icon or choose **Open Microsoft Teams** from its menu to focus Teams.
The icon has light and dark assets and uses a static dark default. It does not
read shared theme state. The dot uses `#f63579` in both variants. The SVG logo assets
are local, so the helper does not need Slack or network access to draw its icon.
The runtime dependency `python-gobject` is in the Linux desktop package profile.

The script also checks `initialTitle`, because Outlook and Linear can share the
`MicrosoftTeams` window class. Duplicate windows use the maximum count, not the
sum. This is the Teams title badge, not an independent total of unread messages.
No browser profile data, credentials, or message bodies are read. The window title
can contain a chat name, but the helper does not display or log it.

Run the tests from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python tests/hyprpanel-teams-unread.py
PYTHONDONTWRITEBYTECODE=1 python tests/hyprpanel-teams-tray.py
```

# Archon light tray icon

`archon-light-tray.py` launches a checksum-keyed extracted copy of the official
`~/Applications/Archon.AppImage`. It changes only the RGB values of the two
bundled tray PNGs to white. It preserves their dimensions and alpha channels,
the original AppImage, the app's tray menu, and its click behavior. This is a
static light icon for the dark panel, not repository-wide theme automation.

The local Archon desktop entry must run this script with Python 3 instead of
running the AppImage directly. Requirements: Python 3, PyGObject, and GdkPixbuf.
Extracted copies live under `~/.cache/archon-light-tray`. The launcher serializes
extraction and does not publish incomplete copies. Old copies stay intact for
running processes. Remove old cache versions only after closing Archon.

AppImage self-updates are unavailable in the extracted copy. To update, replace
`~/Applications/Archon.AppImage` with an official download and restart Archon.
The changed checksum causes the launcher to prepare a new white-icon copy.
If upstream renames the tray assets, preparation fails instead of patching an
unrelated file. To undo, point the desktop entry at the original AppImage again.

Run `PYTHONDONTWRITEBYTECODE=1 python3 tests/archon-light-tray.test.py`.
These tests use generated icons and mocked extraction, with no desktop access.

# HyprPanel tray compatibility

Slack 4.52.155 registers a complete D-Bus bus-name/object-path pair. The installed
`libastal-tray-git r789.82b00fb-1` appends `/StatusNotifierItem` to that pair. This
prevents HyprPanel from loading Slack's icon.

`build-tray-compat.sh` builds a private library from the installed Astal revision.
It changes only the registration parser. It keeps the app's original icon,
including activity badges, and its tray menu. It does not change system packages.

## Build

Required tools: Git, tar, Python, Meson, Ninja, Vala, a C compiler,
`g-ir-compiler`, and the Astal tray development dependencies. The script does not
install dependencies or download source. Use a local clone of
<https://github.com/Aylur/astal> that contains revision
`82b00fba6b9dbfae887468decc493d73aa3f2af8`.

From the dotfiles repository root:

```sh
linux/home/.config/hypr/scripts/build-tray-compat.sh /path/to/astal
```

The build goes into `${XDG_CACHE_HOME:-$HOME/.cache}/hyprpanel/tray-compat`.
`start-hyprpanel.sh` loads its private typelib only when the system library still
matches the recorded checksum. After a system library update, the launcher uses
the system library and prints a warning. Review whether the workaround is still
needed before changing the pinned revision or package check.

## Test and restart

```sh
bash -n linux/home/.config/hypr/scripts/{build-tray-compat,start-hyprpanel}.sh
dbus-run-session -- env TRAY_TEST_ISOLATED=1 \
  GI_TYPELIB_PATH="${XDG_CACHE_HOME:-$HOME/.cache}/hyprpanel/tray-compat/girepository-1.0" \
  python tests/hyprpanel-tray-compat.py
```

The test uses an isolated D-Bus session. It checks bare bus names, sender-relative
object paths, and complete bus-name/object-path pairs. It does not contact Slack.

Restart only the bar, without closing apps:

```sh
astal --instance hyprpanel --quit
nohup "$HOME/.config/hypr/scripts/start-hyprpanel.sh" \
  > "${XDG_RUNTIME_DIR:-/tmp}/hyprpanel.log" 2>&1 < /dev/null &
```

## Remove the workaround

Remove `${XDG_CACHE_HOME:-$HOME/.cache}/hyprpanel/tray-compat`, then restart the bar.
The launcher will use the system library.
