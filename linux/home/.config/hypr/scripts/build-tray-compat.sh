#!/usr/bin/env bash
# Build the tray registration and cleanup fixes against the installed revision.
# Usage: build-tray-compat.sh /path/to/Aylur/astal
set -euo pipefail

source_repo="${1:?Usage: build-tray-compat.sh /path/to/Aylur/astal}"
revision="82b00fba6b9dbfae887468decc493d73aa3f2af8"
system_library="/usr/lib/libastal-tray.so.0.1.0"
package_version="$(pacman -Q libastal-tray-git)"
if [[ "$package_version" != "libastal-tray-git r789.82b00fb-1" ]]; then
    printf 'Unsupported tray package: %s; review the patch before rebuilding.\n' "$package_version" >&2
    exit 1
fi

target="${XDG_CACHE_HOME:-$HOME/.cache}/hyprpanel/tray-compat"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$source_repo" archive "$revision" lib/tray lib/gir.py | tar -x -C "$work"

python3 - "$work/lib/tray/watcher.vala" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
old = '''        } else {
            busName = service;
            path = "/StatusNotifierItem";
        }'''
new = '''        } else {
            // Electron can register a bus name followed by an object path.
            // Preserve that path instead of appending a second default path.
            var parts = service.split("/", 2);
            busName = parts[0];
            path = parts.length == 2 ? "/" + parts[1] : "/StatusNotifierItem";
        }'''
if source.count(old) != 1:
    raise SystemExit("Expected exactly one tray registration parser")
source = source.replace(old, new)

old = '''                if (new_owner == "" && _items.contains(old_owner)) {
                    string full_path = _items.take(old_owner);'''
new = '''                // The table is keyed by the registered name, not its unique owner.
                // Remove on release, disconnect, or replacement by another owner.
                if (old_owner != "" && _items.contains(name)) {
                    string full_path = _items.take(name);'''
if source.count(old) != 1:
    raise SystemExit("Expected exactly one tray owner cleanup handler")
source = source.replace(old, new)

old = '''        Bus.get_sync(BusType.SESSION).signal_subscribe(
            null,'''
new = '''        Bus.get_sync(BusType.SESSION).signal_subscribe(
            "org.freedesktop.DBus",'''
if source.count(old) != 1:
    raise SystemExit("Expected exactly one tray owner signal subscription")
path.write_text(source.replace(old, new))
PY

meson setup "$work/build" "$work/lib/tray" -Dcli=false
meson compile -C "$work/build" astal-tray
mkdir -p "$target/girepository-1.0"
# Replace the inode, never overwrite a library mapped by a running panel.
install -m 755 "$work/build/libastal-tray.so.0.1.0" "$target/libastal-tray.so.0.1.0.new"
mv -f "$target/libastal-tray.so.0.1.0.new" "$target/libastal-tray.so.0.1.0"
# The system typelib contains an absolute library path. Use a private typelib
# as well, so only the HyprPanel process loads the patched library.
g-ir-compiler /usr/share/gir-1.0/AstalTray-0.1.gir \
    --shared-library="$target/libastal-tray.so.0.1.0" \
    --output="$target/girepository-1.0/AstalTray-0.1.typelib"
sha256sum "$system_library" > "$target/system-library.sha256"
printf 'Built HyprPanel tray fix: %s\n' "$target"
