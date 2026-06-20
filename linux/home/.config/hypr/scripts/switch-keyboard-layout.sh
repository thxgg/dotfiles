#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" != "--sync-only" ]]; then
    hyprctl switchxkblayout all next >/dev/null
fi

# Hyprland's compositor XKB layout is used by native Wayland clients, but
# XWayland keeps its own XKB state. Keep XWayland in sync so X11-only apps
# such as Viber can type Bulgarian too.
#
# Keep US as the first XWayland group even while Bulgarian is active. Qt/X11
# apps use the full XKB keymap to resolve accelerators, so this preserves
# Latin shortcuts like Ctrl+A/C/V while the active typing layout is Bulgarian.
if ! command -v setxkbmap >/dev/null 2>&1 || [[ -z "${DISPLAY:-}" ]]; then
    exit 0
fi

active_layout_index="$(hyprctl devices -j | jq -r '.keyboards[] | select(.main == true) | .active_layout_index' | head -n 1)"

target_group=0
if [[ "$active_layout_index" == "1" ]]; then
    target_group=1
fi

lock_xwayland_group() {
    command -v python3 >/dev/null 2>&1 || return 1

    python3 - "$target_group" <<'PY'
from ctypes import CDLL, POINTER, Structure, byref, c_char_p, c_int, c_ubyte, c_uint, c_ushort, c_void_p
import sys

XkbUseCoreKbd = 0x0100

class XkbStateRec(Structure):
    _fields_ = [
        ("group", c_ubyte),
        ("locked_group", c_ubyte),
        ("base_group", c_ushort),
        ("latched_group", c_ushort),
        ("mods", c_ubyte),
        ("base_mods", c_ubyte),
        ("latched_mods", c_ubyte),
        ("locked_mods", c_ubyte),
        ("compat_state", c_ubyte),
        ("grab_mods", c_ubyte),
        ("compat_grab_mods", c_ubyte),
        ("lookup_mods", c_ubyte),
        ("compat_lookup_mods", c_ubyte),
        ("ptr_buttons", c_ushort),
    ]

group = int(sys.argv[1])
libx11 = CDLL("libX11.so.6")
libx11.XOpenDisplay.argtypes = [c_char_p]
libx11.XOpenDisplay.restype = c_void_p
libx11.XkbLockGroup.argtypes = [c_void_p, c_uint, c_uint]
libx11.XkbLockGroup.restype = c_int
libx11.XkbGetState.argtypes = [c_void_p, c_uint, POINTER(XkbStateRec)]
libx11.XkbGetState.restype = c_int
libx11.XFlush.argtypes = [c_void_p]
libx11.XCloseDisplay.argtypes = [c_void_p]

display = libx11.XOpenDisplay(None)
if not display:
    raise SystemExit(1)

try:
    if not libx11.XkbLockGroup(display, XkbUseCoreKbd, group):
        raise SystemExit(1)
    libx11.XFlush(display)

    state = XkbStateRec()
    if libx11.XkbGetState(display, XkbUseCoreKbd, byref(state)) != 0 or state.group != group:
        raise SystemExit(1)
finally:
    libx11.XCloseDisplay(display)
PY
}

if setxkbmap -layout us,bg -variant ,phonetic -option caps:none -option altwin:swap_alt_win >/dev/null 2>&1 \
    && lock_xwayland_group; then
    exit 0
fi

# Fallback for systems without python/libX11 group locking: use the old
# single-layout behavior, which preserves typing but may lose Latin shortcuts
# while Bulgarian is active.
case "$target_group" in
    1)
        setxkbmap -layout bg -variant phonetic -option caps:none -option altwin:swap_alt_win >/dev/null 2>&1 || true
        ;;
    *)
        setxkbmap -layout us -option caps:none -option altwin:swap_alt_win >/dev/null 2>&1 || true
        ;;
esac
