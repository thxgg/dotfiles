# Bootstrap common package-manager paths early so login shells can find tmux,
# zoxide, and other Homebrew-installed tools before the rest of the config runs.
for __dotfiles_bootstrap_path in /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin /usr/local/sbin
    if test -d "$__dotfiles_bootstrap_path"; and not contains -- "$__dotfiles_bootstrap_path" $PATH
        set -gx PATH "$__dotfiles_bootstrap_path" $PATH
    end
end
set -e __dotfiles_bootstrap_path

# fish 4.x terminal probes can leak raw replies in Ghostty/tmux after
# interrupting TTY-owning dev servers. Keep query-term disabled; feature flags
# are read at fish startup, so this guard restores the universal for next shell.
if not contains -- no-query-term $fish_features
    set -Ua fish_features no-query-term
end

# Pi's terminal image detection can see the outer Ghostty environment even when
# the UI is running through tmux. Disable inline terminal graphics inside tmux;
# generated images are still saved and linked, while bare Ghostty can render.
if set -q TMUX
    set -gx PI_TUI_DISABLE_IMAGES 1
end

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
set -l __dotfiles_fish_path (command -s fish 2>/dev/null)
if test -n "$__dotfiles_fish_path"
    set -gx SHELL "$__dotfiles_fish_path"
end

set -gx VISUAL nvim
set -gx EDITOR nvim

set -g fish_greeting

set -q GOPATH; or set -gx GOPATH "$HOME/.local/share/go"
set -q GOBIN; or set -gx GOBIN "$GOPATH/bin"
set -q FVM_CACHE_PATH; or set -gx FVM_CACHE_PATH "$HOME/.local/share/fvm"
set -gx PNPM_HOME "$HOME/.local/share/pnpm"
set -gx BUN_INSTALL "$HOME/.bun"
set -gx RIPGREP_CONFIG_PATH "$HOME/.ripgreprc"
set -gx PLUGINS all

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
__dotfiles_prepend_path "$BUN_INSTALL/bin"
__dotfiles_prepend_path "$HOME/thxgg/.opencode/bin"

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

# Drop inherited fnm state while migrating to Vite+.
set -gx PATH (string match -v '*/fnm_multishells/*' $PATH)
for __dotfiles_fnm_var in FNM_ARCH FNM_COREPACK_ENABLED FNM_DIR FNM_LOGLEVEL FNM_MULTISHELL_PATH FNM_NODE_DIST_MIRROR FNM_RESOLVE_ENGINES FNM_VERSION_FILE_STRATEGY
    set -e $__dotfiles_fnm_var
end
set -e __dotfiles_fnm_var

if test -f "$HOME/.vite-plus/env.fish"
    source "$HOME/.vite-plus/env.fish"
end

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

    if type -q direnv
        direnv hook fish | source
    end
end

set -e __dotfiles_uname
set -e __dotfiles_fish_path

# Pi
set -l __dotfiles_pi_node_bin "$HOME/.vite-plus/js_runtime/node/24.16.0/bin"
if test -d "$__dotfiles_pi_node_bin"
    fish_add_path "$__dotfiles_pi_node_bin"
end
set -e __dotfiles_pi_node_bin

# opencode
fish_add_path /home/thxgg/.opencode/bin
