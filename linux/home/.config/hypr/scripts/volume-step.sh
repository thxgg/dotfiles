#!/usr/bin/env bash

set -euo pipefail

direction="${1:-}"
step="${2:-5}"
max="${3:-100}"

usage() {
    printf 'Usage: %s up|down [step-percent] [max-percent]\n' "${0##*/}" >&2
}

if [[ "$direction" != "up" && "$direction" != "down" ]]; then
    usage
    exit 2
fi

if [[ ! "$step" =~ ^[0-9]+$ || "$step" -eq 0 ]]; then
    usage
    exit 2
fi

if [[ ! "$max" =~ ^[0-9]+$ ]]; then
    usage
    exit 2
fi

lock_file="${XDG_RUNTIME_DIR:-/tmp}/hypr-volume-step.lock"
if command -v flock >/dev/null 2>&1; then
    exec 9>"$lock_file"
    flock 9
fi

get_volume_percent() {
    if command -v pactl >/dev/null 2>&1; then
        local pactl_percent
        pactl_percent="$(pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null | awk -F/ '
            NR == 1 {
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2)
                sub(/%$/, "", $2)
                print int($2)
                exit
            }
        ')"

        if [[ "$pactl_percent" =~ ^[0-9]+$ ]]; then
            printf '%s\n' "$pactl_percent"
            return 0
        fi
    fi

    local wpctl_volume
    wpctl_volume="$(wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null | awk '/Volume:/ { print $2; exit }')"

    if [[ -z "$wpctl_volume" ]]; then
        printf 'Unable to read default sink volume\n' >&2
        return 1
    fi

    awk -v volume="$wpctl_volume" 'BEGIN { printf "%d\n", (volume * 100) + 0.5 }'
}

current="$(get_volume_percent)"

case "$direction" in
    up)
        target=$(( ((current + step) / step) * step ))
        ;;
    down)
        if (( current <= 0 )); then
            target=0
        else
            target=$(( ((current - 1) / step) * step ))
        fi
        ;;
esac

if (( target > max )); then
    target="$max"
elif (( target < 0 )); then
    target=0
fi

wpctl set-volume @DEFAULT_AUDIO_SINK@ "${target}%"
