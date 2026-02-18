export VISUAL=nvim
export EDITOR=nvim
export GOPATH="${GOPATH:-$HOME/.local/share/go}"
export GOBIN="${GOBIN:-$GOPATH/bin}"
export FVM_CACHE_PATH="${FVM_CACHE_PATH:-$HOME/.local/share/fvm}"
export PATH="$HOME/.local/bin:$PATH:$GOBIN"
export ZSH="$HOME/.oh-my-zsh"
# source $HOME/.zsh/catppuccin_latte-zsh-syntax-highlighting.zsh
source $HOME/.zsh/catppuccin_mocha-zsh-syntax-highlighting.zsh
# source $HOME/.zsh/vitesse_black-zsh-syntax-highlighting.zsh

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"
DISABLE_UNTRACKED_FILES_DIRTY="true"
DISABLE_COMPFIX=true
export skip_global_compinit=1
HIST_STAMPS="dd/mm/yyyy"

plugins=(
	git
	zsh-autosuggestions
	zsh-syntax-highlighting
	zsh-z
)

export ZSH_COMPDUMP=$ZSH/cache/.zcompdump-$HOST
source $ZSH/oh-my-zsh.sh

if [[ "$OSTYPE" == darwin* ]]; then
  alias ghosttyrc='cd "$HOME/Library/Application Support/com.mitchellh.ghostty" && $EDITOR config && cd -'
fi
alias zshrc="$EDITOR $HOME/.zshrc"
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

eval "$(fnm env --use-on-cd)"

typeset -g _prompt_newline_after_first=0
typeset -g _prompt_skip_newline_once=0

_prompt_newline_preexec() {
  local -a cmd_words
  local cmd subcmd

  cmd_words=(${(z)1})
  cmd=${cmd_words[1]:-}
  subcmd=${cmd_words[2]:-}

  if [[ "$cmd" == "clear" || "$cmd" == "reset" ]]; then
    _prompt_skip_newline_once=1
  elif [[ "$cmd" == "command" && ( "$subcmd" == "clear" || "$subcmd" == "reset" ) ]]; then
    _prompt_skip_newline_once=1
  fi
}

_prompt_newline_precmd() {
  if (( ! _prompt_newline_after_first )); then
    _prompt_newline_after_first=1
    return
  fi

  if (( _prompt_skip_newline_once )); then
    _prompt_skip_newline_once=0
    return
  fi

  print ""
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _prompt_newline_preexec
add-zsh-hook precmd _prompt_newline_precmd

eval "$(starship init zsh)"

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

# bun completions
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# heroku autocomplete setup
if [[ "$OSTYPE" == darwin* ]]; then
  HEROKU_AC_ZSH_SETUP_PATH="$HOME/Library/Caches/heroku/autocomplete/zsh_setup"
elif [[ "$OSTYPE" == linux-gnu* ]]; then
  HEROKU_AC_ZSH_SETUP_PATH="$HOME/.cache/heroku/autocomplete/zsh_setup"
else
  HEROKU_AC_ZSH_SETUP_PATH=""
fi

[[ -n "$HEROKU_AC_ZSH_SETUP_PATH" && -f "$HEROKU_AC_ZSH_SETUP_PATH" ]] && source "$HEROKU_AC_ZSH_SETUP_PATH"

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

# Initialize completions once after all fpath updates.
fpath=("$HOME/.docker/completions" $fpath)
autoload -Uz compinit
compinit

#compdef opencode
###-begin-opencode-completions-###
#
# yargs command completion script
#
# Installation: opencode completion >> ~/.zshrc
#    or opencode completion >> ~/.zprofile on OSX.
#
_opencode_yargs_completions()
{
  local reply
  local si=$IFS
  IFS=$'
' reply=($(COMP_CWORD="$((CURRENT-1))" COMP_LINE="$BUFFER" COMP_POINT="$CURSOR" opencode --get-yargs-completions "${words[@]}"))
  IFS=$si
  if [[ ${#reply} -gt 0 ]]; then
    _describe 'values' reply
  else
    _default
  fi
}
if [[ "'${zsh_eval_context[-1]}" == "loadautofunc" ]]; then
  _opencode_yargs_completions "$@"
else
  compdef _opencode_yargs_completions opencode
fi
###-end-opencode-completions-###

# Local machine secrets (untracked)
[[ -f ~/.env ]] && source ~/.env
