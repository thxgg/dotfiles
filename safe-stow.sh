#!/usr/bin/env zsh

set -euo pipefail

# Define backup directory with timestamp
BACKUP_DIR="$HOME/.dotfiles_backup_$(date +%Y%m%d_%H%M%S)"
STOW_DIR="."
TARGET_DIR="$HOME"
PACKAGE="common"
STOW_IGNORE_REGEX='\.md$'

typeset -a deploy_paths conflict_paths backup_ok backup_failed
typeset -i backup_dir_created=0

if ! command -v stow >/dev/null 2>&1; then
    echo "Error: stow is required but not installed."
    exit 1
fi

package_root="$STOW_DIR/$PACKAGE"
if [[ ! -d "$package_root" ]]; then
    echo "Error: package directory not found: $package_root"
    exit 1
fi

ensure_backup_dir() {
    if [[ $backup_dir_created -eq 0 ]]; then
        echo "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
        backup_dir_created=1
    fi
}

# Get leaf paths that stow manages (files + symlinks only)
# Keep this in sync with STOW_IGNORE_REGEX used by stow.
deploy_paths=("${(@f)$(cd "$package_root" && find . -mindepth 1 \( -type f -o -type l \) ! -name '*.md' | sed 's|^./||')}")

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
    ensure_backup_dir
    mkdir -p "$(dirname "$backup_target")"

    if mv "$target" "$backup_target"; then
        backup_ok+=("$target")
    else
        backup_failed+=("$target")
        echo "Failed to backup: $target"
    fi
}

enforce_ssh_leaf_linking() {
    local ssh_source_dir="$package_root/.ssh"
    local ssh_target_dir="$TARGET_DIR/.ssh"

    [[ -d "$ssh_source_dir" ]] || return 0

    if [[ -L "$ssh_target_dir" ]]; then
        local resolved_target="${ssh_target_dir:A}"
        local expected_target="${ssh_source_dir:A}"

        if [[ "$resolved_target" != "$expected_target" ]]; then
            echo "Error: $ssh_target_dir is a symlink to $resolved_target"
            echo "Refusing to continue because ~/.ssh must be a real directory for local keys."
            exit 1
        fi

        echo "Migrating folded ~/.ssh symlink to leaf-linked layout"
        backup_target "$ssh_target_dir"
        if [[ ${#backup_failed[@]} -gt 0 ]]; then
            echo "Failed to migrate ~/.ssh symlink; aborting stow."
            exit 1
        fi

        mkdir -p "$ssh_target_dir"
        chmod 700 "$ssh_target_dir" 2>/dev/null || true
        return 0
    fi

    if [[ -e "$ssh_target_dir" && ! -d "$ssh_target_dir" ]]; then
        echo "Error: $ssh_target_dir exists but is not a directory"
        exit 1
    fi

    if [[ ! -d "$ssh_target_dir" ]]; then
        echo "Creating ~/.ssh directory for leaf-linked stow targets"
        mkdir -p "$ssh_target_dir"
        chmod 700 "$ssh_target_dir" 2>/dev/null || true
    fi
}

enforce_config_leaf_linking() {
    local config_source_dir="$package_root/.config"
    local config_target_dir="$TARGET_DIR/.config"

    [[ -d "$config_source_dir" ]] || return 0

    if [[ -L "$config_target_dir" ]]; then
        local resolved_target="${config_target_dir:A}"
        local expected_target="${config_source_dir:A}"

        if [[ "$resolved_target" != "$expected_target" ]]; then
            echo "Error: $config_target_dir is a symlink to $resolved_target"
            echo "Refusing to continue because ~/.config must be a real directory for leaf-linked stow targets."
            exit 1
        fi

        echo "Migrating folded ~/.config symlink to leaf-linked layout"
        backup_target "$config_target_dir"
        if [[ ${#backup_failed[@]} -gt 0 ]]; then
            echo "Failed to migrate ~/.config symlink; aborting stow."
            exit 1
        fi

        mkdir -p "$config_target_dir"
        return 0
    fi

    if [[ -e "$config_target_dir" && ! -d "$config_target_dir" ]]; then
        echo "Error: $config_target_dir exists but is not a directory"
        exit 1
    fi

    if [[ ! -d "$config_target_dir" ]]; then
        echo "Creating ~/.config directory for leaf-linked stow targets"
        mkdir -p "$config_target_dir"
    fi
}

# Check for conflicts and backup if necessary
enforce_config_leaf_linking
enforce_ssh_leaf_linking

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
    echo "Found ${#conflict_paths[@]} conflict(s); backing up before stow"

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
    if [[ ${#backup_ok[@]} -eq 0 ]]; then
        echo "No conflicts found, no backup needed"
    fi
fi

# Perform the stow operation
echo "Stowing $PACKAGE package..."
stow --no-folding --ignore="$STOW_IGNORE_REGEX" -t "$TARGET_DIR" -d "$STOW_DIR" "$PACKAGE"

echo "Stow completed successfully"
if [[ ${#backup_ok[@]} -gt 0 ]]; then
    echo "Your original files were backed up to: $BACKUP_DIR"
fi
