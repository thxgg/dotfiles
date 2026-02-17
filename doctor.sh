#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PACKAGE_ROOT="$SCRIPT_DIR/common"
TARGET_ROOT="$HOME"

typeset -i ok_count=0
typeset -i warn_count=0
typeset -i fail_count=0

print_status() {
    local level="$1"
    local message="$2"

    case "$level" in
        OK)
            ok_count+=1
            printf '[OK] %s\n' "$message"
            ;;
        WARN)
            warn_count+=1
            printf '[WARN] %s\n' "$message"
            ;;
        FAIL)
            fail_count+=1
            printf '[FAIL] %s\n' "$message"
            ;;
    esac
}

if [[ ! -d "$PACKAGE_ROOT" ]]; then
    print_status FAIL "Package root missing: $PACKAGE_ROOT"
    exit 1
fi

if ! command -v stow >/dev/null 2>&1; then
    print_status WARN "stow not found in PATH"
else
    print_status OK "stow is installed"
fi

expected_paths=(
    ".gitconfig"
    ".zshrc"
    ".zprofile"
    ".zshenv"
    ".psqlrc"
    ".ssh"
    ".config"
    "Library/Application Support/com.mitchellh.ghostty/config"
)

for relative_path in "${expected_paths[@]}"; do
    source_path="$PACKAGE_ROOT/$relative_path"
    target_path="$TARGET_ROOT/$relative_path"

    if [[ ! -e "$source_path" && ! -L "$source_path" ]]; then
        print_status WARN "Source missing for $relative_path"
        continue
    fi

    if [[ -L "$target_path" ]]; then
        resolved_target="${target_path:A}"
        expected_target="${source_path:A}"

        if [[ "$resolved_target" == "$expected_target" ]]; then
            print_status OK "$relative_path -> $source_path"
        else
            print_status WARN "$relative_path points to $resolved_target (expected $expected_target)"
        fi
        continue
    fi

    if [[ -e "$target_path" ]]; then
        resolved_target="${target_path:A}"
        expected_target="${source_path:A}"

        if [[ "$resolved_target" == "$expected_target" ]]; then
            print_status OK "$relative_path is managed via symlinked parent"
            continue
        fi
    fi

    if [[ -e "$target_path" ]]; then
        print_status WARN "$relative_path exists but is not a symlink"
    else
        print_status FAIL "$relative_path is missing"
    fi
done

printf '\nSummary: %d OK, %d WARN, %d FAIL\n' "$ok_count" "$warn_count" "$fail_count"

if [[ $fail_count -gt 0 ]]; then
    exit 1
fi
