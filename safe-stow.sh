#!/usr/bin/env zsh

# Define backup directory with timestamp
BACKUP_DIR="$HOME/.dotfiles_backup_$(date +%Y%m%d_%H%M%S)"
STOW_DIR="."
TARGET_DIR="$HOME"
PACKAGE="common"

# Function to check if a path exists and is not a symlink
needs_backup() {
    local path="$1"
    # Return true if path exists and is not a symlink
    [[ -e "$path" && ! -L "$path" ]]
}

# Function to backup a file or directory
backup_path() {
    local path="$1"
    local relative_path="${path#$TARGET_DIR/}"
    local backup_path="$BACKUP_DIR/$relative_path"

    echo "Backing up: $path to $backup_path"
    mkdir -p "$(dirname "$backup_path")"
    mv "$path" "$backup_path"
}

# Get list of files/directories that would be stowed
files=("${(@f)$(cd "$STOW_DIR/$PACKAGE" && find . -mindepth 1 | sed 's|^./||')}")

# Check for conflicts and backup if necessary
NEEDS_BACKUP=0
for item in "${files[@]}"; do
    target_path="$TARGET_DIR/$item"
    if needs_backup "$target_path"; then
        NEEDS_BACKUP=1
        echo "Found conflict: $target_path"
    fi
done

# Create backup directory and perform backups if needed
if [ $NEEDS_BACKUP -eq 1 ]; then
    echo "Creating backup directory: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"

    for item in "${files[@]}"; do
        target_path="$TARGET_DIR/$item"
        if needs_backup "$target_path"; then
            backup_path "$target_path"
        fi
    done
    echo "Backup completed"
else
    echo "No conflicts found, no backup needed"
fi

# Perform the stow operation
echo "Stowing $PACKAGE package..."
stow -t "$TARGET_DIR" -d "$STOW_DIR" "$PACKAGE"

if [ $? -eq 0 ]; then
    echo "✅ Stow completed successfully"
    if [ $NEEDS_BACKUP -eq 1 ]; then
        echo "Your original files were backed up to: $BACKUP_DIR"
    fi
else
    echo "❌ Stow failed"
    exit 1
fi
