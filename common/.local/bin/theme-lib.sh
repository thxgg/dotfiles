#!/usr/bin/env bash

set -euo pipefail

_theme_lib_dir() {
  local src="${BASH_SOURCE[0]:-$0}"
  CDPATH= cd -- "$(dirname -- "$src")" >/dev/null 2>&1 && pwd
}

theme_state_dir() {
  printf '%s\n' "${XDG_STATE_HOME:-$HOME/.local/state}/theme"
}

theme_mode_file() {
  printf '%s/mode\n' "$(theme_state_dir)"
}

theme_current_mode() {
  local mode_file mode
  mode_file="$(theme_mode_file)"

  if [[ -r "$mode_file" ]]; then
    mode="$(tr -d '[:space:]' < "$mode_file")"
    case "$mode" in
      dark|light)
        printf '%s\n' "$mode"
        return 0
        ;;
    esac
  fi

  printf '%s\n' dark
}

theme_ensure_state_dir() {
  mkdir -p "$(theme_state_dir)"
}

theme_runtime_dir() {
  printf '%s/runtime\n' "$(theme_state_dir)"
}

theme_strip_wrapper_dir_from_path() {
  local self_dir old_ifs new_path entry
  self_dir="$(_theme_lib_dir)"
  old_ifs="$IFS"
  IFS=:
  new_path=""

  for entry in $PATH; do
    [[ -n "$entry" && "$entry" == "$self_dir" ]] && continue
    if [[ -z "$new_path" ]]; then
      new_path="$entry"
    else
      new_path+="${new_path:+:}$entry"
    fi
  done

  IFS="$old_ifs"
  PATH="$new_path"
  export PATH
}

theme_exec_real() {
  local command_name="$1"
  shift
  theme_strip_wrapper_dir_from_path
  exec "$command_name" "$@"
}
