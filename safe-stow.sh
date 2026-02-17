#!/usr/bin/env zsh

set -euo pipefail

# Define backup directory with timestamp
BACKUP_DIR="$HOME/.dotfiles_backup_$(date +%Y%m%d_%H%M%S)"
STOW_DIR="."
TARGET_DIR="$HOME"
PACKAGE="common"

typeset -a deploy_paths conflict_paths backup_ok backup_failed

if ! command -v stow >/dev/null 2>&1; then
    echo "Error: stow is required but not installed."
    exit 1
fi

package_root="$STOW_DIR/$PACKAGE"
if [[ ! -d "$package_root" ]]; then
    echo "Error: package directory not found: $package_root"
    exit 1
fi

# Get leaf paths that stow manages (files + symlinks only)
deploy_paths=("${(@f)$(cd "$package_root" && find . -mindepth 1 \( -type f -o -type l \) | sed 's|^./||')}")

# Function to check if target already resolves to source (managed)
is_managed_target() {
    local target="$1"
    local source="$2"

    [[ -e "$target" ]] || return 1
    [[ "${target:A}" == "${source:A}" ]]
}

# Function to check if a path exists and should be backed up
needs_backup() {
    local target="$1"
    local source="$2"

    [[ -e "$target" ]] || return 1
    [[ -L "$target" ]] && return 1
    is_managed_target "$target" "$source" && return 1

    return 0
}

# Function to backup a file
backup_target() {
    local target="$1"
    local relative_path="${target#$TARGET_DIR/}"
    local backup_target="$BACKUP_DIR/$relative_path"

    echo "Backing up: $target to $backup_target"
    mkdir -p "$(dirname "$backup_target")"

    if mv "$target" "$backup_target"; then
        backup_ok+=("$target")
    else
        backup_failed+=("$target")
        echo "Failed to backup: $target"
    fi
}

# Check for conflicts and backup if necessary
for item in "${deploy_paths[@]}"; do
    target_path="$TARGET_DIR/$item"
    source_path="$package_root/$item"

    if needs_backup "$target_path" "$source_path"; then
        conflict_paths+=("$target_path")
        echo "Found conflict: $target_path"
    fi
done

# Create backup directory and perform backups if needed
if [[ ${#conflict_paths[@]} -gt 0 ]]; then
    echo "Creating backup directory: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"

    for target_path in "${conflict_paths[@]}"; do
        backup_target "$target_path"
    done

    echo "Backup summary: ${#backup_ok[@]} succeeded, ${#backup_failed[@]} failed"

    if [[ ${#backup_failed[@]} -gt 0 ]]; then
        echo "Backup failed for ${#backup_failed[@]} path(s); aborting stow."
        for failed_target in "${backup_failed[@]}"; do
            echo " - $failed_target"
        done
        exit 1
    fi

    echo "Backup completed successfully"
else
    echo "No conflicts found, no backup needed"
fi

# Perform the stow operation
echo "Stowing $PACKAGE package..."
stow --no-folding -t "$TARGET_DIR" -d "$STOW_DIR" "$PACKAGE"

echo "✅ Stow completed successfully"
if [[ ${#conflict_paths[@]} -gt 0 ]]; then
    echo "Your original files were backed up to: $BACKUP_DIR"
fi
