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

    python3 - "$runtime_file" "$HOME/.config/hypr/scripts/hyprpanel-bar-visibility.js" <<'PY' || return 1
from pathlib import Path
import sys

runtime_path = Path(sys.argv[1])
source = runtime_path.read_text()
replacements = {
    # A transient missing keymap must not stay Unknown until the next switch.
    '''    self.label = getKeyboardLayout(devices, labelType.get());
  } catch (error) {
    console.error(error);
  }
}
var KbInput''':
        '''    self.label = getKeyboardLayout(devices, labelType.get());
    return !!self.label && self.label !== "Unknown" && self.label !== "Unknown Layout";
  } catch (error) {
    console.error(error);
    return false;
  }
}
var KbInput''',
    '''    labelHook: (self) => {
      useHook(
        self,
        hyprlandService4,
        () => {
          setLabel(self);
        },
        "keyboard-layout"
      );
      useHook(self, labelType, () => {
        setLabel(self);
      });
    },''':
        '''    labelHook: (self) => {
      let retry;
      let destroyed = false;
      const refresh = () => {
        retry?.cancel();
        retry = undefined;
        if (destroyed) return;
        if (!setLabel(self)) {
          retry = timeout(1000, () => {
            retry = undefined;
            refresh();
          });
        }
      };
      self.connect("destroy", () => {
        destroyed = true;
        retry?.cancel();
        retry = undefined;
      });
      useHook(self, hyprlandService4, refresh, "keyboard-layout");
      useHook(self, labelType, refresh);
    },''',
    # Wine exposes ContextMenu without a DBusMenu model. Keep native menus, but
    # call the item's protocol method when there is no exported menu to render.
    '''      if (menuModel === null) {
        return console.error(`Menu Model not found for ${item.id}`);
      }
      if (actionGroup === null) {
        return console.error(`Action Group not found for ${item.id}`);
      }
      menu = createMenu(menuModel, actionGroup);''':
        '''      menu?.destroy();
      menu = undefined;
      if (menuModel === null || actionGroup === null) return;
      menu = createMenu(menuModel, actionGroup);''',
    '''          menu?.popup_at_widget(self, Gdk.Gravity.NORTH, Gdk.Gravity.SOUTH, null);''':
        '''          if (menu) {
            item.about_to_show();
            menu.popup_at_widget(self, Gdk.Gravity.NORTH, Gdk.Gravity.SOUTH, null);
          } else {
            // itemId is the bus name plus object path, not the app's display id.
            const separator = item.itemId.indexOf("/");
            if (separator < 1) return;
            const [x] = self.get_window().get_root_coords(
              Math.round(event.x), Math.round(event.y));
            const bar = self.get_toplevel();
            const [, y] = bar.get_window().get_root_coords(
              0, bar.get_allocated_height() + 2);
            Gio.DBus.session.call(
              item.itemId.slice(0, separator), item.itemId.slice(separator),
              "org.kde.StatusNotifierItem", "ContextMenu",
              new GLib.Variant("(ii)", [x, y]), null,
              Gio.DBusCallFlags.NONE, 2000, null,
              (connection, result) => {
                try {
                  connection.call_finish(result);
                  if (item.title === "Battle.net" && item.id.startsWith("wine-")) {
                    execAsync(["python3", "-B",
                      GLib.get_home_dir() + "/.config/hypr/scripts/battlenet-tray-menu.py",
                      item.itemId.slice(0, separator), String(x), String(y)
                    ]).catch(console.error);
                  }
                } catch (error) {
                  console.error(`Tray context menu failed for ${item.id}: ${error.message}`);
                }
              });
          }''',
    # Replace the focused-client auto-hide subscriptions with one event controller.
    '  autoHide2.initialize();':
        '''  startWoWBarVisibility({
    app: app_default,
    hyprland: autoHide2._hyprlandService,
    visibility: BarVisibility,
    autoHide: autoHide2._autoHide,
    schedule: (callback) => timeout(25, callback),
    cancel: (timer) => timer.cancel()
  });''',
    # Device objects can appear or be replaced without a connectivity change.
    # Reset removed devices and never pass an empty icon to Gtk.Image.
    'var wiredIcon = Variable("");':
        'var wiredIcon = Variable("network-wired-disconnected-symbolic");',
    'var wirelessIcon = Variable("");':
        'var wirelessIcon = Variable("network-wireless-offline-symbolic");',
    '''  if (networkService2.wired === null) {
    return;
  }''':
        '''  if (networkService2.wired === null) {
    wiredIcon.set("network-wired-disconnected-symbolic");
    return;
  }''',
    '''  if (networkService2.wifi === null) {
    return;
  }''':
        '''  if (networkService2.wifi === null) {
    wirelessIcon.set("network-wireless-offline-symbolic");
    return;
  }''',
    '    wiredIcon.set(icon14);':
        '    wiredIcon.set(icon14 || "network-wired-symbolic");',
    '    wirelessIcon.set(icon14);':
        '    wirelessIcon.set(icon14 || "network-wireless-offline-symbolic");',
    'Variable.derive([bind(networkService2, "state"), bind(networkService2, "connectivity")], () => {':
        'Variable.derive([bind(networkService2, "state"), bind(networkService2, "connectivity"), bind(networkService2, "wired"), bind(networkService2, "wifi")], () => {',
    '      return primaryNetwork === AstalNetwork3.Primary.WIRED ? wiredIcon2 : wifiIcon;':
        '''      if (primaryNetwork === AstalNetwork3.Primary.WIRED) return wiredIcon2;
      if (primaryNetwork === AstalNetwork3.Primary.WIFI) return wifiIcon;
      return "network-offline-symbolic";''',
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
        raise SystemExit(f"Expected one HyprPanel compatibility patch target, found {count}: {old}")
    source = source.replace(old, new)

recorder_command = '${SRC_DIR}/scripts/screen_record.sh'
count = source.count(recorder_command)
if count != 4:
    raise SystemExit(f"Expected four HyprPanel recorder commands, found {count}")
source = source.replace(recorder_command, '$HOME/.local/bin/hyprpanel-screen-record')

runtime_path.write_text(Path(sys.argv[2]).read_text() + '\n' + source)
PY

    printf '%s\n' "$runtime_file"
}

# Upstream builds can change their generated symbols. Keep the bar available
# instead of aborting login when an optional compatibility patch no longer fits.
if ! runtime_file="$(prepare_lua_compatible_runtime)"; then
    printf 'HyprPanel compatibility patches do not match this version; using the unmodified launcher. Custom workspace/recording actions, keyboard layout recovery, network icon recovery, tray context menus, and fullscreen WoW bar hiding may be unavailable.\n' >&2
    exec /usr/share/hyprpanel/hyprpanel-app
fi

# The installed Astal watcher cannot parse Electron's bus-name/object-path
# registrations or clean up named entries on exit. Use the private build only
# while the system library matches.
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
