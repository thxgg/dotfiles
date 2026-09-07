#!/usr/bin/env zsh

set -euo pipefail
setopt extendedglob

SCRIPT_DIR="${0:A:h}"
pi_bin=""

if command -v pi >/dev/null 2>&1; then
    pi_bin="$(command -v pi)"
elif [[ -x "${VP_HOME:-$HOME/.vite-plus}/bin/pi" ]]; then
    pi_bin="${VP_HOME:-$HOME/.vite-plus}/bin/pi"
else
    printf '[ERROR] Pi is not installed; run ./setup.sh first\n' >&2
    exit 1
fi

# pi install updates only the matching package entry in user settings. It keeps
# unrelated packages and preferences, and reconciles an existing Git checkout.
while IFS= read -r source || [[ -n "$source" ]]; do
    source="${source%%\#*}"
    source="${source##[[:space:]]#}"
    source="${source%%[[:space:]]#}"
    [[ -n "$source" ]] || continue
    printf '[INFO] Installing declared Pi package: %s\n' "$source"
    GIT_TERMINAL_PROMPT=0 "$pi_bin" install "$source" </dev/null
done < "$SCRIPT_DIR/pi-packages.txt"

printf '[OK] Declared Pi packages installed. Run /transcribe in Pi to configure a local model.\n'
