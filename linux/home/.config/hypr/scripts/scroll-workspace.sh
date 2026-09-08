#!/usr/bin/env bash
# Scroll columns on scrolling layouts; otherwise switch regular workspaces.
set -euo pipefail

case "${1:-}" in
    next) direction=r; workspace=e+1 ;;
    previous) direction=l; workspace=e-1 ;;
    *) printf 'Usage: %s next|previous\n' "$0" >&2; exit 2 ;;
esac

# Drop excess Super+wheel events instead of queuing them or passing them to apps.
# Hold one per-session lock through the action and its 250 ms cooldown.
exec 9>"${XDG_RUNTIME_DIR:?}/${HYPRLAND_INSTANCE_SIGNATURE:-hyprland}-wheel.lock"
flock -n 9 || exit 0

# An open special workspace takes priority over the regular workspace beneath it.
workspace_id=$(hyprctl -j monitors | jq -er '
    .[] | select(.focused) |
    if .specialWorkspace.id != 0 then .specialWorkspace.id else .activeWorkspace.id end
')
layout=$(hyprctl -j workspaces | jq -er --argjson id "$workspace_id" '
    .[] | select(.id == $id) | .tiledLayout
')

if [[ "$layout" == scrolling ]]; then
    hyprctl dispatch layoutmsg "focus $direction"
else
    hyprctl dispatch workspace "$workspace"
fi

sleep 0.25
