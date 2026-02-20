#!/usr/bin/env bash

set -euo pipefail

runtime_dir="${XDG_RUNTIME_DIR:-/tmp}"
key_file="$runtime_dir/hyprpanel-weather-key.json"

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

key_value="${WEATHER_API_KEY:-}"
key_value="${key_value//$'\n'/}"
key_value="${key_value//$'\r'/}"
escaped_key="${key_value//\\/\\\\}"
escaped_key="${escaped_key//\"/\\\"}"

umask 077
printf '{"weather_api_key":"%s"}\n' "$escaped_key" > "$key_file"

cd "$runtime_dir"
exec hyprpanel
