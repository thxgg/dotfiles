#!/usr/bin/env zsh

set -euo pipefail

INPUT_DIR=~/Downloads/berkeley-mono-typeface/berkeley-mono-variable/TTF
OUTPUT_DIR=~/Downloads/berkeley-mono-typeface/berkeley-mono-variable-nerd
FAMILY="Berkeley Mono Variable Nerd Font"

mkdir -p "$OUTPUT_DIR"

for font in "$INPUT_DIR"/*.ttf(N); do
    filename=$(basename "$font")
    style=${${filename%.ttf}##*-}

    echo "Patching $filename (style: $style)..."
    docker run --rm \
        -v "${font}:/in/${filename}:Z" \
        -v "${OUTPUT_DIR}:/out:Z" \
        nerdfonts/patcher \
        --complete \
        --name "${FAMILY}-${style}"
done
