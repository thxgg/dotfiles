#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../../../../.." && pwd)
state=$(mktemp -d "${TMPDIR:-/tmp}/pi-verbosity-check.XXXXXX")
trap 'rm -rf -- "$state"' EXIT
mkdir "$state/agent" "$state/cwd"
cd "$state/cwd"
PI_CODING_AGENT_DIR="$state/agent" PI_OFFLINE=1 PI_TELEMETRY=0 \
  pi --no-extensions -e "$root/common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/test.ts" \
  --no-skills --no-prompt-templates --no-context-files --no-themes \
  --no-session --no-tools --no-approve -p /test-verbosity-lab > "$state/output" 2>&1
# Pi can return zero after an extension command fails. Require the completion marker.
if ! grep -q 'VERBOSITY_LAB_TESTS_PASSED' "$state/output"; then
  printf 'Verbosity lab checks failed.\n' >&2
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$state/output"
  exit 1
fi
printf 'Verbosity lab native-renderer checks passed.\n'
