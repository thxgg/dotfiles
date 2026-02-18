#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
TARGET_ROOT="$HOME"
STOW_ROOTS_HELPER="$SCRIPT_DIR/scripts/lib/stow-roots.zsh"

typeset -a package_roots expected_paths config_children ssh_source_dirs config_source_dirs
typeset -A expected_sources config_child_sources

typeset -i ok_count=0
typeset -i warn_count=0
typeset -i fail_count=0
typeset -i duplicate_count=0

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

if [[ ! -f "$STOW_ROOTS_HELPER" ]]; then
    print_status FAIL "Stow roots helper not found: $STOW_ROOTS_HELPER"
    printf '\nSummary: %d OK, %d WARN, %d FAIL\n' "$ok_count" "$warn_count" "$fail_count"
    exit 1
fi

source "$STOW_ROOTS_HELPER"

collect_expected_entries() {
    local root="$1"
    local package_root="$SCRIPT_DIR/$root"
    local item child
    local root_paths root_config_children

    [[ -d "$package_root" ]] || return

    root_paths=("${(@f)$(cd "$package_root" && find . -mindepth 1 \( -type f -o -type l \) ! -path './.config/*' ! -name '*.md' | sed 's|^./||')}")
    for item in "${root_paths[@]}"; do
        if [[ -n "${expected_sources[$item]-}" ]]; then
            print_status FAIL "Duplicate target path detected: $item (from ${expected_sources[$item]} and $root)"
            duplicate_count+=1
            continue
        fi

        expected_sources[$item]="$root"
        expected_paths+=("$item")
    done

    if [[ -d "$package_root/.config" ]]; then
        root_config_children=("${(@f)$(cd "$package_root/.config" && find . -mindepth 1 -maxdepth 1 \( -type f -o -type l -o \( -type d ! -empty \) \) ! -name '*.md' | sed 's|^./||')}")
        for child in "${root_config_children[@]}"; do
            if [[ -n "${config_child_sources[$child]-}" ]]; then
                print_status FAIL "Duplicate .config child detected: .config/$child (from ${config_child_sources[$child]} and $root)"
                duplicate_count+=1
                continue
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
        [[ -d "$SCRIPT_DIR/$root/.ssh" ]] && ssh_source_dirs+=("$SCRIPT_DIR/$root/.ssh")
        [[ -d "$SCRIPT_DIR/$root/.config" ]] && config_source_dirs+=("$SCRIPT_DIR/$root/.config")
    done
}

check_ssh_directory() {
    local ssh_target_dir="$TARGET_ROOT/.ssh"

    [[ ${#ssh_source_dirs[@]} -gt 0 ]] || return

    if [[ -L "$ssh_target_dir" ]]; then
        print_status FAIL ".ssh is a symlink; expected a real directory for local keys"
        return
    fi

    if [[ -d "$ssh_target_dir" ]]; then
        print_status OK ".ssh directory exists for local keys"
        return
    fi

    if [[ -e "$ssh_target_dir" ]]; then
        print_status FAIL ".ssh exists but is not a directory"
    else
        print_status FAIL ".ssh directory is missing"
    fi
}

check_config_directory() {
    local config_target_dir="$TARGET_ROOT/.config"

    [[ ${#config_source_dirs[@]} -gt 0 ]] || return

    if [[ -L "$config_target_dir" ]]; then
        print_status FAIL ".config is a symlink; expected a real directory for child-linked stow targets"
        return
    fi

    if [[ -d "$config_target_dir" ]]; then
        print_status OK ".config directory exists for child-linked stow targets"
        return
    fi

    if [[ -e "$config_target_dir" ]]; then
        print_status FAIL ".config exists but is not a directory"
    else
        print_status FAIL ".config directory is missing"
    fi
}

check_config_child_links() {
    local config_target_dir="$TARGET_ROOT/.config"
    local child source_root relative_path source_path target_path resolved_target expected_target

    for child in "${config_children[@]}"; do
        source_root="${config_child_sources[$child]}"
        relative_path=".config/$child"
        source_path="$SCRIPT_DIR/$source_root/.config/$child"
        target_path="$config_target_dir/$child"

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
            print_status WARN "$relative_path exists but is not a symlink"
        else
            print_status FAIL "$relative_path is missing"
        fi
    done
}

check_expected_paths() {
    local relative_path source_root source_path target_path resolved_target expected_target

    for relative_path in "${expected_paths[@]}"; do
        source_root="${expected_sources[$relative_path]}"
        source_path="$SCRIPT_DIR/$source_root/$relative_path"
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
}

if ! command -v stow >/dev/null 2>&1; then
    print_status WARN "stow not found in PATH"
else
    print_status OK "stow is installed"
fi

if ! dotfiles_resolve_active_roots "$SCRIPT_DIR" warn; then
    print_status FAIL "$DOTFILES_STOW_RESOLVE_ERROR"
else
    package_roots=("${DOTFILES_ACTIVE_STOW_ROOTS[@]}")

    if [[ -n "$DOTFILES_STOW_RESOLVE_WARNING" ]]; then
        print_status WARN "$DOTFILES_STOW_RESOLVE_WARNING"
    fi

    for root in "${package_roots[@]}"; do
        collect_expected_entries "$root"
    done

    collect_special_source_dirs

    print_status OK "Active stow roots: ${package_roots[*]}"

    if [[ $duplicate_count -gt 0 ]]; then
        print_status FAIL "Found $duplicate_count duplicate stow target(s); fix overlap before deploying"
    fi

    check_ssh_directory
    check_config_directory
    check_config_child_links
    check_expected_paths
fi

printf '\nSummary: %d OK, %d WARN, %d FAIL\n' "$ok_count" "$warn_count" "$fail_count"

if [[ $fail_count -gt 0 ]]; then
    exit 1
fi
