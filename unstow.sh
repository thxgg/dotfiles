#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
TARGET_DIR="$HOME"
COMMON_ROOT="common"
MACOS_ROOT="macos/home"
LINUX_ROOT="linux/home"
STOW_IGNORE_REGEX='^\.config(/|$)|\.md$'

typeset -a package_roots config_children
typeset -A config_child_sources

if ! command -v stow >/dev/null 2>&1; then
    echo "Error: stow is required but not installed."
    exit 1
fi

resolve_package_roots() {
    package_roots=("$COMMON_ROOT")

    case "$OSTYPE" in
        darwin*)
            [[ -d "$SCRIPT_DIR/$MACOS_ROOT" ]] && package_roots+=("$MACOS_ROOT")
            ;;
        linux-gnu*)
            [[ -d "$SCRIPT_DIR/$LINUX_ROOT" ]] && package_roots+=("$LINUX_ROOT")
            ;;
        *)
            echo "Error: unsupported operating system: $OSTYPE"
            exit 1
            ;;
    esac

    local root
    for root in "${package_roots[@]}"; do
        if [[ ! -d "$SCRIPT_DIR/$root" ]]; then
            echo "Error: package directory not found: $SCRIPT_DIR/$root"
            exit 1
        fi
    done
}

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

resolve_package_roots

for root in "${package_roots[@]}"; do
    collect_config_children "$root"
done

echo "Active stow roots: ${package_roots[*]}"

for root in "${package_roots[@]}"; do
    unstow_root "$root"
done

unlink_config_children

echo "Unstow completed"
