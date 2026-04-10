# Auto-start tmux: attach to existing session or create a new one
# Set PI_SKIP_TMUX_AUTOSTART=1 to bypass this when testing other shells.
if command -v tmux &>/dev/null && [[ -z "$PI_SKIP_TMUX_AUTOSTART" && -z "$TMUX" && -z "$INSIDE_EMACS" && -z "$VSCODE_PID" ]]; then
  exec tmux new-session -A -s main
fi

export VISUAL=nvim
export EDITOR=nvim
export GOPATH="${GOPATH:-$HOME/.local/share/go}"
export GOBIN="${GOBIN:-$GOPATH/bin}"
export FVM_CACHE_PATH="${FVM_CACHE_PATH:-$HOME/.local/share/fvm}"
export PATH="$HOME/.local/bin:$PATH:$GOBIN"

if [[ "$OSTYPE" == darwin* ]]; then
  alias ghosttyrc='cd "$HOME/Library/Application Support/com.mitchellh.ghostty" && $EDITOR config && cd -'
fi
alias zshrc="$EDITOR $HOME/.zshrc"
alias fishrc="$EDITOR $HOME/.config/fish/config.fish"
alias nvimrc="cd $HOME/.config/nvim; $EDITOR; cd -"

# opencode
alias oc=opencode

# -------------------------------- #
# Git
# -------------------------------- #

# Lazygit
alias lg='lazygit'
alias ldc='lazydocker'

# Go to project root
alias grt='cd "$(git rev-parse --show-toplevel)"'

alias gs='git status'
alias gp='git push'
alias gpf='git push --force'
alias gpft='git push --follow-tags'
alias gpl='git pull --rebase'
alias gcl='git clone'
alias gst='git stash'
alias grm='git rm'
alias gmv='git mv'

alias main='git checkout main'

alias gco='git checkout'
alias gcob='git checkout -b'

alias gb='git branch'
alias gbd='git branch -d'

alias grb='git rebase'
alias grbom='git rebase origin/master'
alias grbc='git rebase --continue'

alias gl='git log'
alias glo='git log --oneline --graph'

alias grh='git reset HEAD'
alias grh1='git reset HEAD~1'

alias ga='git add'
alias gA='git add -A'

alias gc='git commit'
alias gcm='git commit -m'
alias gca='git commit -a'
alias gcam='git add -A && git commit -m'
alias gfrb='git fetch origin && git rebase origin/master'

alias gxn='git clean -dn'
alias gx='git clean -df'

function gsha() {
  local sha
  sha="$(git rev-parse HEAD)" || return 1

  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$sha" | pbcopy
    printf '%s\n' "$sha"
    return 0
  fi

  if command -v wl-copy >/dev/null 2>&1; then
    printf '%s' "$sha" | wl-copy
    printf '%s\n' "$sha"
    return 0
  fi

  if command -v xclip >/dev/null 2>&1; then
    printf '%s' "$sha" | xclip -selection clipboard
    printf '%s\n' "$sha"
    return 0
  fi

  printf '%s\n' "$sha"
}

alias ghci='gh run list -L 1'

function glp() {
  git --no-pager log -$1
}

function gd() {
  if [[ -z $1 ]] then
    git diff --color | diff-so-fancy
  else
    git diff --color $1 | diff-so-fancy
  fi
}

function gdc() {
  if [[ -z $1 ]] then
    git diff --color --cached | diff-so-fancy
  else
    git diff --color --cached $1 | diff-so-fancy
  fi
}

eval "$(starship init zsh)"

# Initialize zoxide (smart cd replacement, required by sesh)
eval "$(zoxide init zsh)"

# pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end

# java
if [[ -z "$JAVA_HOME" && "$OSTYPE" == darwin* && -x /usr/libexec/java_home ]]; then
  JAVA_HOME="$("/usr/libexec/java_home" -v 21 2>/dev/null)"
  [[ -n "$JAVA_HOME" ]] && export JAVA_HOME
fi

if [[ "$OSTYPE" == darwin* && -d /opt/homebrew/opt/postgresql@18/bin ]]; then
  export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
fi

# Added by LM Studio CLI (lms)
export PATH="$PATH:$HOME/.lmstudio/bin"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

export PATH=$HOME/development/flutter/bin:$PATH

trim_path() {
  local old_ifs="$IFS"
  local -a path_parts deduped
  local -A seen

  IFS=':' path_parts=($PATH)
  IFS="$old_ifs"

  for path_entry in "${path_parts[@]}"; do
    [[ -z "$path_entry" ]] && continue
    if [[ -z "${seen[$path_entry]-}" ]]; then
      deduped+=("$path_entry")
      seen[$path_entry]=1
    fi
  done

  PATH="${(j/:/)deduped}"
  export PATH
}

trim_path
export RIPGREP_CONFIG_PATH="$HOME/.ripgreprc"

# opencode
export PATH="$HOME/thxgg/.opencode/bin:$PATH"

eval "$(fnm env --use-on-cd --shell zsh)"

# Vite+ bin (https://viteplus.dev)
. "$HOME/.vite-plus/env"

# direnv (loads ~/.env and ~/.env.secrets via ~/.envrc + ~/.config/direnv/direnvrc)
export DIRENV_LOG_FORMAT=
if command -v direnv >/dev/null 2>&1; then
  eval "$(direnv hook zsh)"
fi
