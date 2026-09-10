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

manifest="${1:-$SCRIPT_DIR/../common/.pi/agent/npm/package.json}"
# Validate the whole manifest before any install. Pi still owns discovery in
# machine-local settings; dependencies alone do not register its resources.
sources="$(jq -er '
    if (.dependencies | type) != "object" or (.piPackages | type) != "array" then
        error("expected dependencies object and piPackages array")
    else
        [.piPackages[] | if type == "string" and startswith("https://") and (contains("\n") | not) then . else error("invalid Pi Git source") end]
        + [.dependencies | to_entries[] |
            if (.value | type) == "string" and (.value | test("^[~^]?[0-9]+\\.[0-9]+\\.[0-9]+$")) then
                "npm:" + .key + "@" + .value
            else error("expected npm version or range") end]
        | if length == 0 then error("empty package manifest") else .[] end
    end
' "$manifest")" || exit 1

# Capture sources before Pi updates its npm manifest. Keep unrelated settings.
while IFS= read -r source; do
    printf '[INFO] Installing declared Pi package: %s\n' "$source"
    GIT_TERMINAL_PROMPT=0 "$pi_bin" install "$source" </dev/null
done <<< "$sources"

printf '[OK] Declared Pi packages installed. Run /transcribe in Pi to configure a local model.\n'
