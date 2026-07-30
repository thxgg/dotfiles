#!/usr/bin/env bash

set -euo pipefail

runtime_dir="${XDG_RUNTIME_DIR:-/tmp}"
key_file="$runtime_dir/hyprpanel-weather-key.json"
config_root="$runtime_dir/hyprpanel-config-home"
panel_config_dir="$config_root/hyprpanel"
theme_mode_file="${XDG_STATE_HOME:-$HOME/.local/state}/theme/mode"

theme_mode="dark"
if [[ -r "$theme_mode_file" ]]; then
    candidate_mode="$(tr -d '[:space:]' < "$theme_mode_file")"
    if [[ "$candidate_mode" == "light" || "$candidate_mode" == "dark" ]]; then
        theme_mode="$candidate_mode"
    fi
fi

panel_config_source="$HOME/.config/hyprpanel/config.json"
panel_scss_source="$HOME/.config/hyprpanel/modules.scss"
if [[ "$theme_mode" == "light" ]]; then
    panel_config_source="$HOME/.config/hyprpanel/config-light.json"
    panel_scss_source="$HOME/.config/hyprpanel/modules-light.scss"
fi

export PATH="$HOME/.config/hypr/scripts:$PATH"

load_env_file() {
    local env_file="$1"

    if [[ -f "$env_file" ]]; then
        set -a
        # shellcheck source=/dev/null
        . "$env_file"
        set +a
    fi
}

load_env_file "$HOME/.env"
load_env_file "$HOME/.env.secrets"

recover_session_env() {
    if [[ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" && -d "$runtime_dir/hypr" ]]; then
        local latest_hypr_dir
        latest_hypr_dir="$(find "$runtime_dir/hypr" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
        if [[ -n "$latest_hypr_dir" ]]; then
            export HYPRLAND_INSTANCE_SIGNATURE="$(basename "$latest_hypr_dir")"
        fi
    fi

    if [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
        local wayland_socket
        wayland_socket="$(find "$runtime_dir" -maxdepth 1 -type s -name 'wayland-*' | sort | head -n 1)"
        if [[ -n "$wayland_socket" ]]; then
            export WAYLAND_DISPLAY="$(basename "$wayland_socket")"
        fi
    fi
}

recover_session_env

key_value="${WEATHER_API_KEY:-}"
key_value="${key_value//$'\n'/}"
key_value="${key_value//$'\r'/}"
escaped_key="${key_value//\\/\\\\}"
escaped_key="${escaped_key//\"/\\\"}"

umask 077
mkdir -p "$panel_config_dir"
printf '{"weather_api_key":"%s"}\n' "$escaped_key" > "$key_file"
ln -sfn "$panel_config_source" "$panel_config_dir/config.json"
ln -sfn "$HOME/.config/hyprpanel/modules.json" "$panel_config_dir/modules.json"
ln -sfn "$panel_scss_source" "$panel_config_dir/modules.scss"

# HyprPanel caches compiled SCSS under /tmp/hyprpanel and does not always
# invalidate it when our symlinked theme files change.
rm -rf "${TMPDIR:-/tmp}/hyprpanel"

export XDG_CONFIG_HOME="$config_root"

prepare_lua_compatible_runtime() {
    local launcher="/usr/share/hyprpanel/hyprpanel-app"
    local runtime_file="$runtime_dir/hyprpanel-ags.js"

    if [[ ! -r "$launcher" ]]; then
        printf 'HyprPanel launcher not found: %s\n' "$launcher" >&2
        return 1
    fi

    awk '
        /^cat <<EOF \| base64 --decode > \$file$/ { in_payload = 1; next }
        in_payload && /^EOF$/ { exit }
        in_payload { print }
    ' "$launcher" | base64 --decode > "$runtime_file"

    python3 - "$runtime_file" <<'PY'
from pathlib import Path
import sys

runtime_path = Path(sys.argv[1])
source = runtime_path.read_text()
replacements = {
    'hyprlandService9.dispatch("workspace", targetWorkspaceNumber.toString());':
        'hyprlandService9.message(`dispatch hl.dsp.focus({ workspace = ${targetWorkspaceNumber} })`);',
    'hyprlandService12.dispatch("workspace", wsId.toString());':
        'hyprlandService12.message(`dispatch hl.dsp.focus({ workspace = ${wsId} })`);',
}

for old, new in replacements.items():
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"Expected one HyprPanel workspace dispatcher, found {count}: {old}")
    source = source.replace(old, new)

runtime_path.write_text(source)
PY

    printf '%s\n' "$runtime_file"
}

runtime_file="$(prepare_lua_compatible_runtime)"
cd "$runtime_dir"
exec /usr/bin/gjs -m "$runtime_file"
