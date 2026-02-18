#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
TARGET_DIR="$HOME"
STOW_IGNORE_REGEX='^\.config(/|$)|\.md$'
STOW_ROOTS_HELPER="$SCRIPT_DIR/scripts/lib/stow-roots.zsh"
LIST_CONFIG_ONLY=0
ONLY_CONFIG_CSV=""
CONFIG_ONLY_MODE=0

typeset -a package_roots config_children requested_config_children invalid_config_children
typeset -A config_child_sources

usage() {
    cat <<'EOF'
Usage: ./unstow.sh [options]

Options:
  --only-config <csv>  Unlink only selected ~/.config children (e.g. nvim,ghostty)
  --list-config        List available ~/.config components and exit
  --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --only-config)
            if [[ $# -lt 2 ]]; then
                echo "Error: --only-config requires a comma-separated value"
                usage
                exit 1
            fi
            ONLY_CONFIG_CSV="$2"
            shift 2
            ;;
        --list-config)
            LIST_CONFIG_ONLY=1
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "Error: Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if [[ -n "$ONLY_CONFIG_CSV" ]]; then
    CONFIG_ONLY_MODE=1
fi

if [[ $LIST_CONFIG_ONLY -eq 1 && $CONFIG_ONLY_MODE -eq 1 ]]; then
    echo "Error: --list-config cannot be combined with --only-config"
    exit 1
fi

if [[ $CONFIG_ONLY_MODE -eq 0 && $LIST_CONFIG_ONLY -eq 0 ]] && ! command -v stow >/dev/null 2>&1; then
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

    [[ -d "$package_root/.config" ]] || return 0

    root_config_children=(${(@f)"$(cd "$package_root/.config" && find . -mindepth 1 -maxdepth 1 \( -type f -o -type l -o \( -type d ! -empty \) \) ! -name '*.md' | sed 's|^./||')"})

    for child in "${root_config_children[@]}"; do
        [[ -n "$child" ]] || continue

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

print_available_config_children() {
    local child

    if [[ ${#config_children[@]} -eq 0 ]]; then
        echo "No ~/.config components are available in active stow roots."
        return
    fi

    echo "Available ~/.config components:"
    for child in "${config_children[@]}"; do
        echo " - $child (from ${config_child_sources[$child]})"
    done
}

filter_config_children() {
    local raw component
    local -a selected_config_children
    local -A requested_seen

    requested_config_children=()
    invalid_config_children=()

    for raw in ${(s:,:)ONLY_CONFIG_CSV}; do
        component="${raw//[[:space:]]/}"
        [[ -n "$component" ]] || continue

        if [[ -n "${requested_seen[$component]-}" ]]; then
            continue
        fi

        requested_seen[$component]=1
        requested_config_children+=("$component")
    done

    if [[ ${#requested_config_children[@]} -eq 0 ]]; then
        echo "Error: --only-config requires at least one component name"
        exit 1
    fi

    selected_config_children=()
    for component in "${requested_config_children[@]}"; do
        if [[ -n "${config_child_sources[$component]-}" ]]; then
            selected_config_children+=("$component")
        else
            invalid_config_children+=("$component")
        fi
    done

    if [[ ${#invalid_config_children[@]} -gt 0 ]]; then
        echo "Error: Unknown ~/.config component(s): ${invalid_config_children[*]}"
        print_available_config_children
        exit 1
    fi

    config_children=("${selected_config_children[@]}")
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

if [[ $LIST_CONFIG_ONLY -eq 1 ]]; then
    print_available_config_children
    exit 0
fi

if [[ $CONFIG_ONLY_MODE -eq 1 ]]; then
    filter_config_children
fi

echo "Active stow roots: ${package_roots[*]}"
if [[ $CONFIG_ONLY_MODE -eq 1 ]]; then
    echo "Selected ~/.config components: ${config_children[*]}"
fi

if [[ $CONFIG_ONLY_MODE -eq 0 ]]; then
    for root in "${package_roots[@]}"; do
        unstow_root "$root"
    done
fi

unlink_config_children

echo "Unstow completed"
