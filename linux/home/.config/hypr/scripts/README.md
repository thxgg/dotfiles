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
The icon has light and dark variants and follows the saved theme mode. The dot
uses `#f63579` in both themes. The SVG logo assets
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
