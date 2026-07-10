#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
TARGET_ROOT="$HOME"
STOW_ROOTS_HELPER="$SCRIPT_DIR/scripts/lib/stow-roots.zsh"
DOT_COMMAND_TARGET=".local/bin/dot"
SPECIAL_LEAF_TARGETS=(.codex/AGENTS.md)
LIST_CONFIG_ONLY=0
ONLY_CONFIG_CSV=""
CONFIG_ONLY_MODE=0
VERBOSE=0

typeset -a package_roots expected_paths config_children ssh_source_dirs config_source_dirs
typeset -a requested_config_children invalid_config_children warn_messages fail_messages
typeset -A expected_sources config_child_sources

typeset -i ok_count=0
typeset -i warn_count=0
typeset -i fail_count=0
typeset -i duplicate_count=0

usage() {
    cat <<'EOF'
Usage: ./doctor.sh [options]

Options:
  --only-config <csv>  Check only selected ~/.config children (e.g. nvim,ghostty)
  --list-config        List available ~/.config components and exit
  -v, --verbose        Print every successful check
  --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --only-config)
            if [[ $# -lt 2 ]]; then
                printf '[FAIL] %s\n' "--only-config requires a comma-separated value"
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
        -v|--verbose)
            VERBOSE=1
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            printf '[FAIL] %s\n' "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if [[ -n "$ONLY_CONFIG_CSV" ]]; then
    CONFIG_ONLY_MODE=1
fi

if [[ $LIST_CONFIG_ONLY -eq 1 && $CONFIG_ONLY_MODE -eq 1 ]]; then
    printf '[FAIL] %s\n' "--list-config cannot be combined with --only-config"
    exit 1
fi

print_status() {
    local level="$1"
    local message="$2"

    case "$level" in
        OK)
            ok_count+=1
            if [[ $VERBOSE -eq 1 ]]; then
                printf '[OK] %s\n' "$message"
            fi
            ;;
        WARN)
            warn_count+=1
            warn_messages+=("$message")
            ;;
        FAIL)
            fail_count+=1
            fail_messages+=("$message")
            ;;
    esac
}

print_summary() {
    local message

    printf '\nSummary: %d OK, %d WARN, %d FAIL\n' "$ok_count" "$warn_count" "$fail_count"
    for message in "${warn_messages[@]}"; do
        printf '[WARN] %s\n' "$message"
    done
    for message in "${fail_messages[@]}"; do
        printf '[FAIL] %s\n' "$message"
    done
}

if [[ ! -f "$STOW_ROOTS_HELPER" ]]; then
    print_status FAIL "Stow roots helper not found: $STOW_ROOTS_HELPER"
    print_summary
    exit 1
fi

source "$STOW_ROOTS_HELPER"

collect_expected_entries() {
    local root="$1"
    local package_root="$SCRIPT_DIR/$root"
    local item child
    local root_paths root_config_children

    [[ -d "$package_root" ]] || return

    root_paths=(${(@f)"$(cd "$package_root" && find . -mindepth 1 \( -name 'node_modules' -o -name '.git' \) -prune -o \( -type f -o -type l \) ! -path './.config/*' -print | sed 's|^./||')"})
    for item in "${root_paths[@]}"; do
        [[ -n "$item" ]] || continue
        dotfiles_is_stow_ignored_path "$item" && continue

        if [[ -n "${expected_sources[$item]-}" ]]; then
            print_status FAIL "Duplicate target path detected: $item (from ${expected_sources[$item]} and $root)"
            duplicate_count+=1
            continue
        fi

        expected_sources[$item]="$root"
        expected_paths+=("$item")
    done

    if [[ -d "$package_root/.config" ]]; then
        root_config_children=(${(@f)"$(cd "$package_root/.config" && find . -mindepth 1 -maxdepth 1 \( -type f -o -type l -o \( -type d ! -empty \) \) ! -name '*.md' | sed 's|^./||')"})
        for child in "${root_config_children[@]}"; do
            [[ -n "$child" ]] || continue

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

collect_special_expected_entries() {
    local root item package_root

    for root in "${package_roots[@]}"; do
        package_root="$SCRIPT_DIR/$root"

        for item in "${SPECIAL_LEAF_TARGETS[@]}"; do
            [[ -e "$package_root/$item" || -L "$package_root/$item" ]] || continue

            if [[ -n "${expected_sources[$item]-}" ]]; then
                print_status FAIL "Duplicate target path detected: $item (from ${expected_sources[$item]} and $root)"
                duplicate_count+=1
                continue
            fi

            expected_sources[$item]="$root"
            expected_paths+=("$item")
        done
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
        print_status FAIL "--only-config requires at least one component name"
        print_summary
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
        print_status FAIL "Unknown ~/.config component(s): ${invalid_config_children[*]}"
        print_available_config_children
        print_summary
        exit 1
    fi

    config_children=("${selected_config_children[@]}")
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

check_dot_command_link() {
    local source_path="$SCRIPT_DIR/dot"
    local target_path="$TARGET_ROOT/$DOT_COMMAND_TARGET"
    local target_dir="${target_path:h}"
    local resolved_target expected_target

    if [[ ! -f "$source_path" ]]; then
        print_status FAIL "dot command source is missing: $source_path"
        return
    fi

    if [[ -L "$target_path" ]]; then
        resolved_target="${target_path:A}"
        expected_target="${source_path:A}"

        if [[ "$resolved_target" == "$expected_target" ]]; then
            print_status OK "$DOT_COMMAND_TARGET -> $source_path"
        else
            print_status WARN "$DOT_COMMAND_TARGET points to $resolved_target (expected $expected_target)"
        fi
    elif [[ -e "$target_path" ]]; then
        print_status WARN "$DOT_COMMAND_TARGET exists but is not a symlink"
    else
        print_status FAIL "$DOT_COMMAND_TARGET is missing"
    fi

    case ":$PATH:" in
        *":$target_dir:"*) print_status OK "$target_dir is in PATH" ;;
        *) print_status WARN "$target_dir is not in PATH for this shell" ;;
    esac
}

check_pi_runtime_locality() {
    local target_path relative_path resolved_target root package_root ancestor
    local found_managed=0

    for ancestor in ".pi" ".pi/.pi" ".pi/agent"; do
        target_path="$TARGET_ROOT/$ancestor"
        [[ -L "$target_path" ]] || continue
        resolved_target="${target_path:A}"
        for root in "${package_roots[@]}"; do
            package_root="${SCRIPT_DIR:A}/$root"
            if [[ "$resolved_target" == "$package_root" || "$resolved_target" == "$package_root/"* ]]; then
                print_status FAIL "Pi directory must be unfolded before runtime state can be local: $ancestor -> $resolved_target"
                found_managed=1
                break
            fi
        done
    done

    [[ -d "$TARGET_ROOT/.pi" ]] || return

    while IFS= read -r target_path; do
        relative_path="${target_path#$TARGET_ROOT/}"
        dotfiles_is_pi_runtime_path "$relative_path" || continue
        resolved_target="${target_path:A}"

        for root in "${package_roots[@]}"; do
            package_root="${SCRIPT_DIR:A}/$root"
            if [[ "$resolved_target" == "$package_root" || "$resolved_target" == "$package_root/"* ]]; then
                print_status FAIL "Machine-local Pi runtime path is still managed by Stow: $relative_path -> $resolved_target"
                found_managed=1
                break
            fi
        done
    done < <(find "$TARGET_ROOT/.pi" -mindepth 1 -type l -print 2>/dev/null)

    if [[ $found_managed -eq 0 ]]; then
        print_status OK "Pi runtime state is machine-local"
    fi
}

check_pi_workspace() {
    local pi_bin=""
    local vp_bin=""
    local npm_bin=""
    local workspace="$SCRIPT_DIR/common/.pi"
    local pi_version=""
    local vp_version=""

    if command -v pi >/dev/null 2>&1; then
        pi_bin="$(command -v pi)"
    elif [[ -x "${VP_HOME:-$HOME/.vite-plus}/bin/pi" ]]; then
        pi_bin="${VP_HOME:-$HOME/.vite-plus}/bin/pi"
    fi

    if [[ -z "$pi_bin" ]]; then
        print_status FAIL "Pi is not installed"
    else
        pi_version="$("$pi_bin" --version 2>/dev/null || true)"
        if [[ -n "$pi_version" ]]; then
            print_status OK "Pi is installed ($pi_version)"
        else
            print_status FAIL "Pi executable failed: $pi_bin"
        fi
    fi

    if command -v vp >/dev/null 2>&1; then
        vp_bin="$(command -v vp)"
    elif [[ -x "${VP_HOME:-$HOME/.vite-plus}/bin/vp" ]]; then
        vp_bin="${VP_HOME:-$HOME/.vite-plus}/bin/vp"
    fi
    if [[ -z "$vp_bin" ]]; then
        print_status FAIL "Vite+ is unavailable for locked Pi workspace installs"
    else
        vp_version="$("$vp_bin" --version 2>/dev/null | head -n 1 || true)"
        if [[ -n "$vp_version" ]]; then
            print_status OK "Vite+ is installed ($vp_version)"
        else
            print_status FAIL "Vite+ executable failed: $vp_bin"
        fi
    fi

    if [[ ! -f "$workspace/package-lock.json" ]]; then
        print_status FAIL "Pi extension lockfile is missing"
        return
    fi
    print_status OK "Pi extension lockfile exists"

    if command -v npm >/dev/null 2>&1; then
        npm_bin="$(command -v npm)"
    elif [[ -x "${VP_HOME:-$HOME/.vite-plus}/bin/npm" ]]; then
        npm_bin="${VP_HOME:-$HOME/.vite-plus}/bin/npm"
    else
        print_status FAIL "npm is unavailable for Pi extension checks"
        return
    fi

    if [[ ! -d "$workspace/node_modules" ]]; then
        print_status FAIL "Pi extension dependencies are not installed; run vp install --frozen-lockfile in common/.pi"
        return
    fi

    if "$npm_bin" ls --prefix "$workspace" --workspaces --depth=0 >/dev/null 2>&1; then
        print_status OK "Pi extension workspace dependencies are healthy"
    else
        print_status FAIL "Pi extension workspace dependencies are incomplete; run vp install --frozen-lockfile in common/.pi"
    fi
}

if [[ $LIST_CONFIG_ONLY -eq 0 ]]; then
    if ! command -v stow >/dev/null 2>&1; then
        print_status WARN "stow not found in PATH"
    else
        print_status OK "stow is installed"
    fi
    check_pi_workspace
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
    collect_special_expected_entries

    collect_special_source_dirs

    if [[ $LIST_CONFIG_ONLY -eq 1 ]]; then
        print_available_config_children
        exit 0
    fi

    if [[ $CONFIG_ONLY_MODE -eq 1 ]]; then
        filter_config_children
    fi

    print_status OK "Active stow roots: ${package_roots[*]}"
    if [[ $CONFIG_ONLY_MODE -eq 1 ]]; then
        print_status OK "Selected ~/.config components: ${config_children[*]}"
    fi

    if [[ $duplicate_count -gt 0 ]]; then
        print_status FAIL "Found $duplicate_count duplicate stow target(s); fix overlap before deploying"
    fi

    if [[ $CONFIG_ONLY_MODE -eq 0 ]]; then
        check_ssh_directory
    fi
    check_config_directory
    check_config_child_links
    if [[ $CONFIG_ONLY_MODE -eq 0 ]]; then
        check_expected_paths
        check_dot_command_link
        check_pi_runtime_locality
    fi
fi

print_summary

if [[ $fail_count -gt 0 ]]; then
    exit 1
fi
