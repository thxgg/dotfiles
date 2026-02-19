#!/usr/bin/env bash
# Adapted from mitsuhiko/agent-stuff (Apache-2.0):
# skills/mermaid/tools/validate.sh
#
# Modifications in this version:
# - ASCII-only status output
# - Minor wording cleanup

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 diagram.mmd [output.svg]"
  exit 1
fi

INPUT="$1"
OUTPUT="${2:-}"

if [ ! -f "$INPUT" ]; then
  echo "Error: file not found: $INPUT"
  exit 1
fi

CLEANUP=0
if [ -z "$OUTPUT" ]; then
  OUTPUT="$(mktemp /tmp/mermaid_validate.XXXXXX.svg)"
  CLEANUP=1
fi

trap 'if [ "$CLEANUP" -eq 1 ]; then rm -f "$OUTPUT"; fi' EXIT

echo "Validating: $INPUT"

# Use Mermaid CLI to parse and render. Any CLI error means invalid syntax.
if npx -y @mermaid-js/mermaid-cli -i "$INPUT" -o "$OUTPUT" -q; then
  echo "[OK] Mermaid validation succeeded"
  echo
  echo "ASCII preview:"

  if ! MERMAID_INPUT="$INPUT" npx -y --package beautiful-mermaid node -e '
const fs = require("node:fs");
const path = require("node:path");
const binPath = process.env.PATH.split(":")[0];
const moduleRoot = path.dirname(binPath);
const { renderMermaidAscii } = require(path.join(moduleRoot, "beautiful-mermaid"));
const text = fs.readFileSync(process.env.MERMAID_INPUT, "utf8");
process.stdout.write(renderMermaidAscii(text));
process.stdout.write("\n");
'; then
    echo "Warning: ASCII preview failed (diagram type may be unsupported)."
  fi

  if [ "$CLEANUP" -eq 0 ]; then
    echo "Rendered to: $OUTPUT"
  fi
else
  echo "[ERROR] Mermaid validation failed"
  exit 1
fi
