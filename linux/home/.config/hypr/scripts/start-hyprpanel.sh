#!/usr/bin/env bash

set -euo pipefail

# This directory holds secrets and executable generated code. Never use /tmp.
runtime_dir="${XDG_RUNTIME_DIR:?A private XDG_RUNTIME_DIR is required}"
if [[ ! -d "$runtime_dir" || ! -O "$runtime_dir" || -L "$runtime_dir" ]]; then
    printf 'Invalid session runtime directory: %s\n' "$runtime_dir" >&2
    exit 1
fi
key_file="$runtime_dir/hyprpanel-weather-key.json"
config_root="$runtime_dir/hyprpanel-config-home"
panel_config_dir="$config_root/hyprpanel"
# Use the static application configuration. Do not read shared theme state.
panel_config_source="$HOME/.config/hyprpanel/config.json"
panel_scss_source="$HOME/.config/hyprpanel/modules.scss"

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
            HYPRLAND_INSTANCE_SIGNATURE="$(basename "$latest_hypr_dir")"
            export HYPRLAND_INSTANCE_SIGNATURE
        fi
    fi

    if [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
        local wayland_socket
        wayland_socket="$(find "$runtime_dir" -maxdepth 1 -type s -name 'wayland-*' | sort | head -n 1)"
        if [[ -n "$wayland_socket" ]]; then
            WAYLAND_DISPLAY="$(basename "$wayland_socket")"
            export WAYLAND_DISPLAY
        fi
    fi
}

recover_session_env

# The helper owns a session lock and survives bar/theme restarts. It registers
# only while the Teams PWA is open, and reconnects when the tray host changes.
nohup python3 -B "$HOME/.config/hypr/scripts/teams-tray.py" \
    > "$runtime_dir/teams-pwa-tray.log" 2>&1 < /dev/null &

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
    ' "$launcher" | base64 --decode > "$runtime_file" || return 1
    [[ -s "$runtime_file" ]] || return 1

    python3 - "$runtime_file" <<'PY' || return 1
from pathlib import Path
import sys

runtime_path = Path(sys.argv[1])
source = runtime_path.read_text()
replacements = {
    'hyprlandService9.dispatch("workspace", targetWorkspaceNumber.toString());':
        'hyprlandService9.message(`dispatch hl.dsp.focus({ workspace = ${targetWorkspaceNumber} })`);',
    'hyprlandService12.dispatch("workspace", wsId.toString());':
        'hyprlandService12.message(`dispatch hl.dsp.focus({ workspace = ${wsId} })`);',
    '''/* @__PURE__ */ jsxs(LeftColumn, { isVisible: true, children: [
            /* @__PURE__ */ jsx2(RightShortcut1, {}),
            /* @__PURE__ */ jsx2(SettingsButton, {})
          ] }),
          /* @__PURE__ */ jsxs(RightColumn, { children: [
            /* @__PURE__ */ jsx2(RightShortcut3, {}),
            /* @__PURE__ */ jsx2(RecordingButton, {})
          ] })''':
        '''/* @__PURE__ */ jsxs(LeftColumn, { isVisible: true, children: [
            /* @__PURE__ */ jsx2(RightShortcut1, {}),
            /* @__PURE__ */ jsx2(RecordingButton, {})
          ] }),
          /* @__PURE__ */ jsxs(RightColumn, { children: [
            /* @__PURE__ */ jsx2(RightShortcut3, {}),
            /* @__PURE__ */ jsx2(SettingsButton, {})
          ] })''',
}

for old, new in replacements.items():
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"Expected one HyprPanel workspace dispatcher, found {count}: {old}")
    source = source.replace(old, new)

recorder_command = '${SRC_DIR}/scripts/screen_record.sh'
count = source.count(recorder_command)
if count != 4:
    raise SystemExit(f"Expected four HyprPanel recorder commands, found {count}")
source = source.replace(recorder_command, '$HOME/.local/bin/hyprpanel-screen-record')

runtime_path.write_text(source)
PY

    printf '%s\n' "$runtime_file"
}

# Upstream builds can change their generated symbols. Keep the bar available
# instead of aborting login when an optional compatibility patch no longer fits.
if ! runtime_file="$(prepare_lua_compatible_runtime)"; then
    printf 'HyprPanel compatibility patches do not match this version; using the unmodified launcher. Custom workspace/recording actions may be unavailable.\n' >&2
    exec /usr/share/hyprpanel/hyprpanel-app
fi

# The installed Astal watcher cannot parse Electron's bus-name/object-path
# registrations. Use the private build only while the system library matches.
tray_compat="${XDG_CACHE_HOME:-$HOME/.cache}/hyprpanel/tray-compat"
if [[ -r "$tray_compat/system-library.sha256" ]]; then
    if sha256sum --check --status "$tray_compat/system-library.sha256" \
        && [[ -r "$tray_compat/libastal-tray.so.0.1.0" ]] \
        && [[ -r "$tray_compat/girepository-1.0/AstalTray-0.1.typelib" ]]; then
        export GI_TYPELIB_PATH="$tray_compat/girepository-1.0${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    else
        printf 'HyprPanel tray compatibility build is stale; rebuild or remove it.\n' >&2
    fi
fi

cd "$runtime_dir"
exec /usr/bin/gjs -m "$runtime_file"
