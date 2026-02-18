#!/usr/bin/env zsh

typeset -g DOTFILES_STOW_COMMON_ROOT="common"
typeset -g DOTFILES_STOW_MACOS_ROOT="macos/home"
typeset -g DOTFILES_STOW_LINUX_ROOT="linux/home"

typeset -ga DOTFILES_ACTIVE_STOW_ROOTS
typeset -g DOTFILES_STOW_RESOLVE_WARNING=""
typeset -g DOTFILES_STOW_RESOLVE_ERROR=""

dotfiles_resolve_active_roots() {
    local repo_root="$1"
    local mode="${2:-strict}"
    local repo_root_abs

    DOTFILES_ACTIVE_STOW_ROOTS=()
    DOTFILES_STOW_RESOLVE_WARNING=""
    DOTFILES_STOW_RESOLVE_ERROR=""

    if [[ -z "$repo_root" ]]; then
        DOTFILES_STOW_RESOLVE_ERROR="repo_root is required"
        return 1
    fi

    case "$mode" in
        strict|warn)
            ;;
        *)
            DOTFILES_STOW_RESOLVE_ERROR="invalid resolve mode: $mode"
            return 1
            ;;
    esac

    repo_root_abs="${repo_root:A}"

    if [[ ! -d "$repo_root_abs/$DOTFILES_STOW_COMMON_ROOT" ]]; then
        DOTFILES_STOW_RESOLVE_ERROR="package directory not found: $repo_root_abs/$DOTFILES_STOW_COMMON_ROOT"
        return 1
    fi

    DOTFILES_ACTIVE_STOW_ROOTS=("$DOTFILES_STOW_COMMON_ROOT")

    case "$OSTYPE" in
        darwin*)
            [[ -d "$repo_root_abs/$DOTFILES_STOW_MACOS_ROOT" ]] && DOTFILES_ACTIVE_STOW_ROOTS+=("$DOTFILES_STOW_MACOS_ROOT")
            ;;
        linux-gnu*)
            [[ -d "$repo_root_abs/$DOTFILES_STOW_LINUX_ROOT" ]] && DOTFILES_ACTIVE_STOW_ROOTS+=("$DOTFILES_STOW_LINUX_ROOT")
            ;;
        *)
            if [[ "$mode" == "strict" ]]; then
                DOTFILES_STOW_RESOLVE_ERROR="unsupported operating system: $OSTYPE"
                return 1
            fi
            DOTFILES_STOW_RESOLVE_WARNING="unsupported operating system for OS-specific roots: $OSTYPE"
            ;;
    esac

    local root
    for root in "${DOTFILES_ACTIVE_STOW_ROOTS[@]}"; do
        if [[ ! -d "$repo_root_abs/$root" ]]; then
            DOTFILES_STOW_RESOLVE_ERROR="package directory not found: $repo_root_abs/$root"
            return 1
        fi
    done

    return 0
}
