# Recreate the Ghostty temp directory if a cleanup tool removes it.
if set -q TMPDIR; and not test -d "$TMPDIR"
    command mkdir -p -m 700 -- "$TMPDIR"
end

# Bootstrap common package-manager paths early so login shells can find
# zoxide and other Homebrew-installed tools before the rest of the config runs.
for __dotfiles_bootstrap_path in /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin /usr/local/sbin
    if test -d "$__dotfiles_bootstrap_path"; and not contains -- "$__dotfiles_bootstrap_path" $PATH
        set -gx PATH "$__dotfiles_bootstrap_path" $PATH
    end
end
set -e __dotfiles_bootstrap_path

function __dotfiles_prepend_path --argument-names dir
    if test -n "$dir"; and not contains -- $dir $PATH
        set -gx PATH $dir $PATH
    end
end

function __dotfiles_append_path --argument-names dir
    if test -n "$dir"; and not contains -- $dir $PATH
        set -gx PATH $PATH $dir
    end
end

set __dotfiles_uname (uname)
if test "$__dotfiles_uname" = Darwin; and test -d "$HOME/.docker/bin"
    fish_add_path --global --path --append "$HOME/.docker/bin"
end
set -l __dotfiles_fish_path (command -s fish 2>/dev/null)
if test -n "$__dotfiles_fish_path"
    set -gx SHELL "$__dotfiles_fish_path"
end

set -gx VISUAL nvim
set -gx EDITOR nvim
alias vim nvim

set -g fish_greeting

set -q GOPATH; or set -gx GOPATH "$HOME/.local/share/go"
set -q GOBIN; or set -gx GOBIN "$GOPATH/bin"
set -q FVM_CACHE_PATH; or set -gx FVM_CACHE_PATH "$HOME/.local/share/fvm"
set -gx PNPM_HOME "$HOME/.local/share/pnpm"
set -gx BUN_INSTALL "$HOME/.bun"
set -gx RIPGREP_CONFIG_PATH "$HOME/.ripgreprc"

__dotfiles_prepend_path "$HOME/.local/bin"
__dotfiles_prepend_path "$HOME/.local/share/sonarqube-cli/bin"
__dotfiles_prepend_path "$GOBIN"

if test -d "$HOME/.cargo/bin"
    __dotfiles_prepend_path "$HOME/.cargo/bin"
end

# Homebrew's rustup is keg-only and may leave ~/.cargo/bin symlinks pointing at
# an outdated Cellar revision after upgrades.
if test "$__dotfiles_uname" = Darwin; and test -d /opt/homebrew/opt/rustup/bin
    __dotfiles_prepend_path /opt/homebrew/opt/rustup/bin
end

__dotfiles_prepend_path "$PNPM_HOME"
__dotfiles_prepend_path "$PNPM_HOME/bin"
__dotfiles_prepend_path "$BUN_INSTALL/bin"

if test "$__dotfiles_uname" = Darwin; and test -d /opt/homebrew/opt/postgresql@18/bin
    __dotfiles_prepend_path /opt/homebrew/opt/postgresql@18/bin
end

__dotfiles_append_path "$HOME/.lmstudio/bin"
__dotfiles_append_path "$HOME/development/flutter/bin"

functions -e __dotfiles_prepend_path __dotfiles_append_path

if not set -q JAVA_HOME; and test "$__dotfiles_uname" = Darwin; and test -x /usr/libexec/java_home
    set -l __dotfiles_java_home (/usr/libexec/java_home -v 21 2>/dev/null)
    if test -n "$__dotfiles_java_home"
        set -gx JAVA_HOME "$__dotfiles_java_home"
    end
end

if test -f "$HOME/.vite-plus/env.fish"
    source "$HOME/.vite-plus/env.fish"
end

# Keep dotfile wrappers ahead of package-manager shims added above.
if set -l __dotfiles_local_bin_index (contains -i -- "$HOME/.local/bin" $PATH)
    set -e PATH[$__dotfiles_local_bin_index]
end
set -gx PATH "$HOME/.local/bin" $PATH
set -e __dotfiles_local_bin_index

if status is-interactive
    set -g __dotfiles_prompt_newline_after_first 0
    set -g __dotfiles_prompt_skip_newline_once 0

    function __dotfiles_prompt_newline_preexec --on-event fish_preexec
        set -l words (string split ' ' -- $argv[1])
        set -l cmd $words[1]
        set -l subcmd $words[2]

        if contains -- $cmd clear reset
            set -g __dotfiles_prompt_skip_newline_once 1
        else if test "$cmd" = command; and contains -- $subcmd clear reset
            set -g __dotfiles_prompt_skip_newline_once 1
        end
    end

    function __dotfiles_prompt_newline_prompt --on-event fish_prompt
        if test "$__dotfiles_prompt_newline_after_first" -eq 0
            set -g __dotfiles_prompt_newline_after_first 1
            return
        end

        if test "$__dotfiles_prompt_skip_newline_once" -eq 1
            set -g __dotfiles_prompt_skip_newline_once 0
            return
        end

        echo
    end

    if type -q zoxide
        zoxide init fish | source
    end

    if type -q starship
        starship init fish | source
    end

    set -gx DIRENV_LOG_FORMAT

    if type -q direnv; and not functions -q __direnv_export_eval
        direnv hook fish | source
    end
end

set -e __dotfiles_uname
set -e __dotfiles_fish_path
