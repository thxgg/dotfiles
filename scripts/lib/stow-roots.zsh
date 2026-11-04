#!/usr/bin/env zsh

typeset -g DOTFILES_STOW_COMMON_ROOT="common"
typeset -g DOTFILES_STOW_MACOS_ROOT="macos/home"
typeset -g DOTFILES_STOW_LINUX_ROOT="linux/home"
typeset -g DOTFILES_PI_RUNTIME_REGEX='^\.pi/(\.pi/)?todos(/|$)|^\.pi/(\.pi/)?agent/(settings(-extensions)?\.json|pi-(transcribe|voice)\.json|auth\.json|mcp-auth\.json|mcp-cache\.json|mcp-npx-cache\.json|trust\.json|[^/]+\.local\.jsonc?)$|^\.pi/(\.pi/)?agent/(git|mcp-oauth|history|sessions|\.cache)(/|$)'
typeset -g DOTFILES_STOW_IGNORE_REGEX="^\\.config(/|$)|(^|/)AGENTS\\.md$|(^|/)\\.gitignore$|(^|/)node_modules(/|$)|$DOTFILES_PI_RUNTIME_REGEX"

# Stow's --no-folding would create SKILL.md file symlinks, which Codex skips.
# Skill roots are deployed separately, one direct child directory at a time.
typeset -g DOTFILES_STOW_SKILL_IGNORE_REGEX='(^|/)\.(agents|claude)/skills(/|$)'

dotfiles_skill_entries() {
    local package_root="$1"
    local skill_root entry

    for skill_root in .agents/skills .claude/skills; do
        [[ -d "$package_root/$skill_root" ]] || continue
        while IFS= read -r entry; do
            [[ -n "$entry" ]] || continue
            dotfiles_is_stow_ignored_path "$skill_root/$entry" && continue
            print -r -- "$skill_root/$entry"
        done < <(cd "$package_root/$skill_root" && find . -mindepth 1 -maxdepth 1 \( -type f -o -type l -o \( -type d ! -empty \) \) -print | sed 's|^./||')
    done
}

typeset -ga DOTFILES_ACTIVE_STOW_ROOTS
typeset -g DOTFILES_STOW_RESOLVE_WARNING=""
typeset -g DOTFILES_STOW_RESOLVE_ERROR=""

dotfiles_is_stow_ignored_path() {
    local path="${1#./}"
    [[ "$path" =~ $DOTFILES_STOW_IGNORE_REGEX ]]
}

dotfiles_is_pi_runtime_path() {
    local path="${1#./}"
    [[ "$path" =~ $DOTFILES_PI_RUNTIME_REGEX ]]
}

# Resolve the link text explicitly: zsh :A alone can leave a dangling link
# unresolved. Normalize relative link text against the link's parent directory.
dotfiles_resolved_link_target() {
    local target="$1"
    local link_target

    if [[ -L "$target" ]]; then
        link_target="$(readlink "$target")" || return 1
        [[ "$link_target" == /* ]] || link_target="${target:h}/$link_target"
        print -r -- "${link_target:A}"
    else
        print -r -- "${target:A}"
    fi
}

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
