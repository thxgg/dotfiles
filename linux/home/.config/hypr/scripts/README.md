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
