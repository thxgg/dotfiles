#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
TARGET_DIR="$HOME"
STOW_IGNORE_REGEX='^\.config(/|$)|\.md$'
STOW_ROOTS_HELPER="$SCRIPT_DIR/scripts/lib/stow-roots.zsh"

typeset -a package_roots config_children
typeset -A config_child_sources

if ! command -v stow >/dev/null 2>&1; then
    echo "Error: stow is required but not installed."
    exit 1
fi

if [[ ! -f "$STOW_ROOTS_HELPER" ]]; then
    echo "Error: stow roots helper not found: $STOW_ROOTS_HELPER"
    exit 1
fi

source "$STOW_ROOTS_HELPER"

collect_config_children() {
    local root="$1"
    local package_root="$SCRIPT_DIR/$root"
    local child
    local root_config_children

    [[ -d "$package_root/.config" ]] || return

    root_config_children=("${(@f)$(cd "$package_root/.config" && find . -mindepth 1 -maxdepth 1 \( -type f -o -type l -o \( -type d ! -empty \) \) ! -name '*.md' | sed 's|^./||')}")

    for child in "${root_config_children[@]}"; do
        if [[ -n "${config_child_sources[$child]-}" ]]; then
            echo "Error: duplicate .config child detected: .config/$child"
            echo " - from: ${config_child_sources[$child]}"
            echo " - from: $root"
            echo "Refusing to continue. Shared and OS-specific roots must not overlap."
            exit 1
        fi

        config_child_sources[$child]="$root"
        config_children+=("$child")
    done
}

unstow_root() {
    local root="$1"
    local package_dir="$SCRIPT_DIR/$root"
    local stow_dir="${package_dir:h}"
    local stow_package="${package_dir:t}"

    echo "Unstowing $root package..."
    stow -D --no-folding --ignore="$STOW_IGNORE_REGEX" -t "$TARGET_DIR" -d "$stow_dir" "$stow_package"
}

unlink_config_children() {
    local child source_root source_path target_path

    for child in "${config_children[@]}"; do
        source_root="${config_child_sources[$child]}"
        source_path="$SCRIPT_DIR/$source_root/.config/$child"
        target_path="$TARGET_DIR/.config/$child"

        [[ -L "$target_path" ]] || continue

        if [[ "${target_path:A}" == "${source_path:A}" ]]; then
            rm "$target_path"
            echo "Removed ~/.config/$child"
        else
            echo "Skipping ~/.config/$child (points elsewhere)"
        fi
    done
}

if ! dotfiles_resolve_active_roots "$SCRIPT_DIR" strict; then
    echo "Error: $DOTFILES_STOW_RESOLVE_ERROR"
    exit 1
fi

package_roots=("${DOTFILES_ACTIVE_STOW_ROOTS[@]}")

for root in "${package_roots[@]}"; do
    collect_config_children "$root"
done

echo "Active stow roots: ${package_roots[*]}"

for root in "${package_roots[@]}"; do
    unstow_root "$root"
done

unlink_config_children

echo "Unstow completed"
