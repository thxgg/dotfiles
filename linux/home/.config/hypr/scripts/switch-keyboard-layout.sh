#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" != "--sync-only" ]]; then
    hyprctl switchxkblayout all next >/dev/null
fi

# Hyprland's compositor XKB layout is used by native Wayland clients, but
# XWayland keeps its own XKB state. Keep XWayland in sync so apps like Discord
# can type Bulgarian too.
if ! command -v setxkbmap >/dev/null 2>&1 || [[ -z "${DISPLAY:-}" ]]; then
    exit 0
fi

active_layout_index="$(hyprctl devices -j | jq -r '.keyboards[] | select(.main == true) | .active_layout_index' | head -n 1)"

case "$active_layout_index" in
    1)
        setxkbmap -layout bg -variant phonetic -option caps:none -option altwin:swap_alt_win >/dev/null 2>&1 || true
        ;;
    *)
        setxkbmap -layout us -option caps:none -option altwin:swap_alt_win >/dev/null 2>&1 || true
        ;;
esac
