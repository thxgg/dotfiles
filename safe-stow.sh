#!/usr/bin/env zsh

set -euo pipefail

# Define backup directory with timestamp
BACKUP_DIR="$HOME/.dotfiles_backup_$(date +%Y%m%d_%H%M%S)"
STOW_DIR="${0:A:h}"
TARGET_DIR="$HOME"
STOW_IGNORE_REGEX='^\.config(/|$)|\.md$'
STOW_ROOTS_HELPER="$STOW_DIR/scripts/lib/stow-roots.zsh"

typeset -a package_roots deploy_paths conflict_paths backup_ok backup_failed config_children
typeset -a ssh_source_dirs config_source_dirs
typeset -A deploy_sources config_child_sources
typeset -i backup_dir_created=0

if ! command -v stow >/dev/null 2>&1; then
    echo "Error: stow is required but not installed."
    exit 1
fi

if [[ ! -f "$STOW_ROOTS_HELPER" ]]; then
    echo "Error: stow roots helper not found: $STOW_ROOTS_HELPER"
    exit 1
fi

source "$STOW_ROOTS_HELPER"

collect_package_entries() {
    local root="$1"
    local package_root="$STOW_DIR/$root"
    local item child
    local root_deploy_paths root_config_children

    root_deploy_paths=(${(@f)"$(cd "$package_root" && find . -mindepth 1 \( -type f -o -type l \) ! -path './.config/*' ! -name '*.md' | sed 's|^./||')"})

    for item in "${root_deploy_paths[@]}"; do
        [[ -n "$item" ]] || continue

        if [[ -n "${deploy_sources[$item]-}" ]]; then
            echo "Error: duplicate target path detected: $item"
            echo " - from: ${deploy_sources[$item]}"
            echo " - from: $root"
            echo "Refusing to continue. Shared and OS-specific roots must not overlap."
            exit 1
        fi

        deploy_sources[$item]="$root"
        deploy_paths+=("$item")
    done

    if [[ -d "$package_root/.config" ]]; then
        root_config_children=(${(@f)"$(cd "$package_root/.config" && find . -mindepth 1 -maxdepth 1 \( -type f -o -type l -o \( -type d ! -empty \) \) ! -name '*.md' | sed 's|^./||')"})

        for child in "${root_config_children[@]}"; do
            [[ -n "$child" ]] || continue

            if [[ -n "${config_child_sources[$child]-}" ]]; then
                echo "Error: duplicate ~/.config child detected: .config/$child"
                echo " - from: ${config_child_sources[$child]}"
                echo " - from: $root"
                echo "Refusing to continue. Shared and OS-specific roots must not overlap."
                exit 1
            fi

            config_child_sources[$child]="$root"
            config_children+=("$child")
        done
    fi
}

collect_special_source_dirs() {
    local root

    ssh_source_dirs=()
    config_source_dirs=()

    for root in "${package_roots[@]}"; do
        [[ -d "$STOW_DIR/$root/.ssh" ]] && ssh_source_dirs+=("$STOW_DIR/$root/.ssh")
        [[ -d "$STOW_DIR/$root/.config" ]] && config_source_dirs+=("$STOW_DIR/$root/.config")
    done
}

path_matches_any() {
    local candidate="$1"
    shift

    local expected
    for expected in "$@"; do
        if [[ "$candidate" == "${expected:A}" ]]; then
            return 0
        fi
    done

    return 1
}

record_conflict_path() {
    local candidate="$1"
    local existing

    for existing in "${conflict_paths[@]}"; do
        [[ "$existing" == "$candidate" ]] && return 1
    done

    conflict_paths+=("$candidate")
    return 0
}

find_ancestor_symlink_conflict() {
    local target="$1"
    local source="$2"
    local current_target="${target:h}"
    local current_source="${source:h}"
    local resolved_target expected_target

    while [[ "$current_target" != "$TARGET_DIR" && "$current_target" != "/" ]]; do
        if [[ -L "$current_target" ]]; then
            resolved_target="${current_target:A}"
            expected_target="${current_source:A}"

            if [[ "$resolved_target" != "$expected_target" ]]; then
                printf '%s\n' "$current_target"
                return 0
            fi
        fi

        current_target="${current_target:h}"
        current_source="${current_source:h}"
    done

    return 1
}

ensure_backup_dir() {
    if [[ $backup_dir_created -eq 0 ]]; then
        echo "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
        backup_dir_created=1
    fi
}

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

    if [[ "$target" == "$TARGET_DIR" || "$target" == "$TARGET_DIR/" || "${target:A}" == "${TARGET_DIR:A}" ]]; then
        backup_failed+=("$target")
        echo "Refusing to backup home directory root: $target"
        return 1
    fi

    if [[ -z "$relative_path" || "$relative_path" == /* ]]; then
        backup_failed+=("$target")
        echo "Refusing to backup unsafe path: $target"
        return 1
    fi

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
    local ssh_target_dir="$TARGET_DIR/.ssh"
    local resolved_target

    [[ ${#ssh_source_dirs[@]} -gt 0 ]] || return 0

    if [[ -L "$ssh_target_dir" ]]; then
        resolved_target="${ssh_target_dir:A}"

        if ! path_matches_any "$resolved_target" "${ssh_source_dirs[@]}"; then
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
    local config_target_dir="$TARGET_DIR/.config"
    local resolved_target

    [[ ${#config_source_dirs[@]} -gt 0 ]] || return 0

    if [[ -L "$config_target_dir" ]]; then
        resolved_target="${config_target_dir:A}"

        if ! path_matches_any "$resolved_target" "${config_source_dirs[@]}"; then
            echo "Error: $config_target_dir is a symlink to $resolved_target"
            echo "Refusing to continue because ~/.config must be a real directory for child-linked stow targets."
            exit 1
        fi

        echo "Migrating folded ~/.config symlink to child-linked layout"
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
        echo "Creating ~/.config directory for child-linked stow targets"
        mkdir -p "$config_target_dir"
    fi
}

needs_config_child_backup() {
    local target="$1"
    local source="$2"

    [[ -e "$target" || -L "$target" ]] || return 1
    is_managed_target "$target" "$source" && return 1

    return 0
}

link_config_children() {
    local config_target_dir="$TARGET_DIR/.config"
    local child source_root source_path source_path_abs target_path

    for child in "${config_children[@]}"; do
        source_root="${config_child_sources[$child]}"
        source_path="$STOW_DIR/$source_root/.config/$child"
        source_path_abs="${source_path:A}"
        target_path="$config_target_dir/$child"

        if is_managed_target "$target_path" "$source_path_abs"; then
            continue
        fi

        if [[ -e "$target_path" || -L "$target_path" ]]; then
            echo "Error: $target_path still exists after conflict handling"
            echo "Refusing to overwrite unknown content while linking ~/.config children."
            exit 1
        fi

        ln -s "$source_path_abs" "$target_path"
    done
}

stow_root() {
    local root="$1"
    local package_dir="$STOW_DIR/$root"
    local stow_dir="${package_dir:h}"
    local stow_package="${package_dir:t}"

    echo "Stowing $root package..."
    stow --no-folding --ignore="$STOW_IGNORE_REGEX" -t "$TARGET_DIR" -d "$stow_dir" "$stow_package"
}

if ! dotfiles_resolve_active_roots "$STOW_DIR" strict; then
    echo "Error: $DOTFILES_STOW_RESOLVE_ERROR"
    exit 1
fi

package_roots=("${DOTFILES_ACTIVE_STOW_ROOTS[@]}")

for root in "${package_roots[@]}"; do
    collect_package_entries "$root"
done

collect_special_source_dirs

echo "Active stow roots: ${package_roots[*]}"

# Check for conflicts and backup if necessary
enforce_config_leaf_linking
enforce_ssh_leaf_linking

for item in "${deploy_paths[@]}"; do
    ancestor_conflict=""
    source_root="${deploy_sources[$item]}"
    target_path="$TARGET_DIR/$item"
    source_path="$STOW_DIR/$source_root/$item"

    ancestor_conflict="$(find_ancestor_symlink_conflict "$target_path" "$source_path" || true)"
    if [[ -n "$ancestor_conflict" ]]; then
        if record_conflict_path "$ancestor_conflict"; then
            echo "Found conflict: $ancestor_conflict"
        fi
        continue
    fi

    if needs_backup "$target_path" "$source_path"; then
        if record_conflict_path "$target_path"; then
            echo "Found conflict: $target_path"
        fi
    fi
done

for child in "${config_children[@]}"; do
    ancestor_conflict=""
    source_root="${config_child_sources[$child]}"
    target_path="$TARGET_DIR/.config/$child"
    source_path="$STOW_DIR/$source_root/.config/$child"

    ancestor_conflict="$(find_ancestor_symlink_conflict "$target_path" "$source_path" || true)"
    if [[ -n "$ancestor_conflict" ]]; then
        if record_conflict_path "$ancestor_conflict"; then
            echo "Found conflict: $ancestor_conflict"
        fi
        continue
    fi

    if needs_config_child_backup "$target_path" "$source_path"; then
        if record_conflict_path "$target_path"; then
            echo "Found conflict: $target_path"
        fi
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
for root in "${package_roots[@]}"; do
    stow_root "$root"
done

link_config_children

echo "Stow completed successfully"
if [[ ${#backup_ok[@]} -gt 0 ]]; then
    echo "Your original files were backed up to: $BACKUP_DIR"
fi
