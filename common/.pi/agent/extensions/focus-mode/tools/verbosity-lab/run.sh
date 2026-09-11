#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../../../../.." && pwd)
case "${1:-preview}" in
  preview)
    if (( $# > 1 )); then printf 'Usage: %s [preview|low|normal]\n' "$0" >&2; exit 2; fi
    state=$(mktemp -d "${TMPDIR:-/tmp}/pi-verbosity-lab.XXXXXX")
    trap 'rm -rf -- "$state"' EXIT
    mkdir -p "$state/cwd" "$state/agent"
    cd "$state/cwd"
    PI_CODING_AGENT_DIR="$state/agent" PI_OFFLINE=1 PI_TELEMETRY=0 \
      pi --no-extensions --no-skills --no-prompt-templates --no-context-files \
      --no-themes --no-tools --no-session --no-approve \
      --theme "$root/common/.pi/agent/themes/catppuccin-latte.json" \
      --use-theme catppuccin-latte --tui-mode fullscreen \
      -e "$root/common/.pi/agent/extensions/focus-mode/tools/verbosity-lab/index.ts" /verbosity-lab
    ;;
  low|normal)
    level=$1
    shift
    PI_FOCUS_BUILTINS=1 PI_VERBOSITY_WEB=1 pi \
      -e "$root/common/.pi/agent/extensions/focus-mode/index.ts" \
      -e "$root/common/.pi/agent/extensions/web-tools/index.ts" \
      --verbosity "$level" "$@"
    ;;
  *) printf 'Usage: %s [preview|low|normal]\n' "$0" >&2; exit 2 ;;
esac
