export VISUAL=zed
export EDITOR=zed
export PATH="$HOME/.local/bin:$PATH:$(go env GOBIN):$(go env GOPATH)/bin"
export ZSH="$HOME/.oh-my-zsh"
source $HOME/.zsh/catppuccin_mocha-zsh-syntax-highlighting.zsh

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"
DISABLE_UNTRACKED_FILES_DIRTY="true"
HIST_STAMPS="dd/mm/yyyy"

plugins=(
	git
	zsh-autosuggestions
	zsh-syntax-highlighting
	zsh-z
)

export ZSH_COMPDUMP=$ZSH/cache/.zcompdump-$HOST
source $ZSH/oh-my-zsh.sh

alias alacrittyrc="cd ~/.config/alacritty; $EDITOR; cd -"
alias zshrc="$EDITOR ~/.zshrc"
alias nvimrc="cd ~/.config/nvim; $EDITOR; cd -"

# -------------------------------- #
# Git
# -------------------------------- #

# Use github/hub
alias git=hub

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

alias gsha='git rev-parse HEAD | pbcopy'

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
eval "$(starship init zsh)"

# pnpm
export PNPM_HOME="~/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end

# java
export JAVA_HOME=`/usr/libexec/java_home -v 17`
