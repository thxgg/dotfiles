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

voice_version="$(jq -r '.dependencies["@earendil-works/pi-voice"] // empty' "$manifest")"

# Capture sources before Pi updates its npm manifest. Keep unrelated settings.
while IFS= read -r source; do
    printf '[INFO] Installing declared Pi package: %s\n' "$source"
    GIT_TERMINAL_PROMPT=0 "$pi_bin" install "$source" </dev/null
done <<< "$sources"

# Remove only the retired package registration after its replacement installed.
# Pi owns the checkout removal. Model settings and downloaded models stay local.
if [[ -n "$voice_version" ]]; then
    # npm save-prefix may turn an exact pin into a caret range during pi install.
    # Restore the declared pin without replacing a Stow symlink.
    manifest_target="${manifest:A}"
    manifest_tmp="$(mktemp "${manifest_target}.XXXXXX")"
    if jq --arg version "$voice_version" '.dependencies["@earendil-works/pi-voice"] = $version' \
        "$manifest_target" > "$manifest_tmp"; then
        chmod --reference="$manifest_target" "$manifest_tmp" 2>/dev/null || chmod 644 "$manifest_tmp"
        mv "$manifest_tmp" "$manifest_target"
    else
        rm -f "$manifest_tmp"
        exit 1
    fi
    agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
    [[ "$agent_dir" == '~/'* ]] && agent_dir="$HOME/${agent_dir#\~/}"
    if [[ -f "$agent_dir/settings.json" ]]; then
        legacy_sources="$(jq -er '[.packages[]? | if type == "string" then . else .source end |
            select(test("^(https://github.com/|git:github.com/)earendil-works/pi-transcribe(@|$)"))] | .[]' \
            "$agent_dir/settings.json" 2>/dev/null || true)"
        if [[ -n "$legacy_sources" ]]; then
            while IFS= read -r source; do
                "$pi_bin" remove "$source" </dev/null
            done <<< "$legacy_sources"
        fi
    fi
fi

printf '[OK] Declared Pi packages installed. Run /voice-settings in Pi to configure a local model.\n'
