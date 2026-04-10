# Bootstrap common package-manager paths early so login shells can find tmux,
# zoxide, and other Homebrew-installed tools before the rest of the config runs.
for __dotfiles_bootstrap_path in /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin /usr/local/sbin
    if test -d "$__dotfiles_bootstrap_path"; and not contains -- "$__dotfiles_bootstrap_path" $PATH
        set -gx PATH "$__dotfiles_bootstrap_path" $PATH
    end
end
set -e __dotfiles_bootstrap_path

# Set PI_SKIP_TMUX_AUTOSTART=1 to bypass this when testing fish outside tmux.
if status is-interactive
    if not set -q PI_SKIP_TMUX_AUTOSTART; and type -q tmux; and test -z "$TMUX"; and test -z "$INSIDE_EMACS"; and test -z "$VSCODE_PID"
        exec tmux new-session -A -s main
    end
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

# Catppuccin Mocha syntax highlighting
set -g fish_greeting
set -g fish_color_normal cdd6f4
set -g fish_color_command a6e3a1
set -g fish_color_keyword cba6f7
set -g fish_color_quote a6e3a1
set -g fish_color_redirection f5c2e7
set -g fish_color_end fab387
set -g fish_color_error f38ba8 --bold
set -g fish_color_param cdd6f4
set -g fish_color_valid_path a6e3a1 --underline
set -g fish_color_option 89dceb
set -g fish_color_comment 6c7086
set -g fish_color_operator f5c2e7
set -g fish_color_escape fab387
set -g fish_color_autosuggestion 585b70
set -g fish_color_selection --background=313244
set -g fish_color_search_match --background=45475a

set -q GOPATH; or set -gx GOPATH "$HOME/.local/share/go"
set -q GOBIN; or set -gx GOBIN "$GOPATH/bin"
set -q FVM_CACHE_PATH; or set -gx FVM_CACHE_PATH "$HOME/.local/share/fvm"
set -gx PNPM_HOME "$HOME/.local/share/pnpm"
set -gx BUN_INSTALL "$HOME/.bun"
set -gx RIPGREP_CONFIG_PATH "$HOME/.ripgreprc"

__dotfiles_prepend_path "$HOME/.local/bin"
__dotfiles_prepend_path "$GOBIN"

if test -d "$HOME/.cargo/bin"
    __dotfiles_prepend_path "$HOME/.cargo/bin"
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

if test -f "$HOME/.vite-plus/env.fish"
    source "$HOME/.vite-plus/env.fish"
end

alias zshrc '$EDITOR $HOME/.zshrc'
alias fishrc '$EDITOR $HOME/.config/fish/config.fish'
alias oc 'opencode'
alias lg 'lazygit'
alias ldc 'lazydocker'
alias gs 'git status'
alias gp 'git push'
alias gpf 'git push --force'
alias gpft 'git push --follow-tags'
alias gpl 'git pull --rebase'
alias gcl 'git clone'
alias gst 'git stash'
alias grm 'git rm'
alias gmv 'git mv'
alias main 'git checkout main'
alias gco 'git checkout'
alias gcob 'git checkout -b'
alias gb 'git branch'
alias gbd 'git branch -d'
alias grb 'git rebase'
alias grbom 'git rebase origin/master'
alias grbc 'git rebase --continue'
alias gl 'git log'
alias glo 'git log --oneline --graph'
alias grh 'git reset HEAD'
alias grh1 'git reset HEAD~1'
alias ga 'git add'
alias gA 'git add -A'
alias gc 'git commit'
alias gcm 'git commit -m'
alias gca 'git commit -a'
alias gcam 'git add -A; and git commit -m'
alias gfrb 'git fetch origin; and git rebase origin/master'
alias gxn 'git clean -dn'
alias gx 'git clean -df'
alias ghci 'gh run list -L 1'

if test "$__dotfiles_uname" = Darwin
    function ghosttyrc
        pushd "$HOME/Library/Application Support/com.mitchellh.ghostty" >/dev/null; or return
        $EDITOR config
        set -l edit_status $status
        popd >/dev/null
        return $edit_status
    end
end

function nvimrc
    pushd "$HOME/.config/nvim" >/dev/null; or return
    $EDITOR
    set -l edit_status $status
    popd >/dev/null
    return $edit_status
end

function grt
    set -l git_root (git rev-parse --show-toplevel 2>/dev/null); or return
    cd "$git_root"
end

function gsha
    set -l sha (git rev-parse HEAD 2>/dev/null); or return 1

    if type -q pbcopy
        printf '%s' "$sha" | pbcopy
        printf '%s\n' "$sha"
        return 0
    end

    if type -q wl-copy
        printf '%s' "$sha" | wl-copy
        printf '%s\n' "$sha"
        return 0
    end

    if type -q xclip
        printf '%s' "$sha" | xclip -selection clipboard
        printf '%s\n' "$sha"
        return 0
    end

    printf '%s\n' "$sha"
end

function glp
    if test (count $argv) -eq 0
        echo 'usage: glp <count>' >&2
        return 1
    end

    git --no-pager log -$argv[1]
end

function gd
    if test (count $argv) -eq 0
        git diff --color | diff-so-fancy
    else
        git diff --color $argv | diff-so-fancy
    end
end

function gdc
    if test (count $argv) -eq 0
        git diff --color --cached | diff-so-fancy
    else
        git diff --color --cached $argv | diff-so-fancy
    end
end

function sesh-sessions
    type -q sesh; or return 1
    type -q fzf; or return 1

    set -l session (sesh list -t -c | fzf --height 40% --reverse --border-label ' sesh ' --border --prompt '⚡  ')

    if status is-interactive
        commandline -f repaint >/dev/null 2>&1
    end

    test -z "$session"; and return
    sesh connect "$session"
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

    function fish_user_key_bindings
        for mode in default insert visual
            bind -M $mode \es sesh-sessions
        end

        if test -n "$TMUX"
            for mode in default insert
                bind -M $mode \e\[13\;2u 'commandline -f execute'
                bind -M $mode \e\[27\;2\;13~ 'commandline -f execute'
            end
        end
    end

    if type -q zoxide
        zoxide init fish | source
    end

    if type -q fnm
        fnm env --use-on-cd --shell fish | source
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
