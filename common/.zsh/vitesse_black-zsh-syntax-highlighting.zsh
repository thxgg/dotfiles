# Vitesse Black Theme (for zsh-syntax-highlighting)
#
# Paste this files contents inside your ~/.zshrc before you activate zsh-syntax-highlighting
ZSH_HIGHLIGHT_HIGHLIGHTERS=(main cursor)
typeset -gA ZSH_HIGHLIGHT_STYLES

# Main highlighter styling: https://github.com/zsh-users/zsh-syntax-highlighting/blob/master/docs/highlighters/main.md
#
## General
### Diffs
### Markup
## Classes
## Comments
ZSH_HIGHLIGHT_STYLES[comment]='fg=#758575'
## Constants
## Entitites
## Functions/methods
ZSH_HIGHLIGHT_STYLES[alias]='fg=#80a665'
ZSH_HIGHLIGHT_STYLES[suffix-alias]='fg=#80a665'
ZSH_HIGHLIGHT_STYLES[global-alias]='fg=#80a665'
ZSH_HIGHLIGHT_STYLES[function]='fg=#80a665'
ZSH_HIGHLIGHT_STYLES[command]='fg=#80a665'
ZSH_HIGHLIGHT_STYLES[precommand]='fg=#80a665,italic'
ZSH_HIGHLIGHT_STYLES[autodirectory]='fg=#b8a965,italic'
ZSH_HIGHLIGHT_STYLES[single-hyphen-option]='fg=#b8a965'
ZSH_HIGHLIGHT_STYLES[double-hyphen-option]='fg=#b8a965'
ZSH_HIGHLIGHT_STYLES[back-quoted-argument]='fg=#6394bf'
## Keywords
## Built ins
ZSH_HIGHLIGHT_STYLES[builtin]='fg=#4d9375'
ZSH_HIGHLIGHT_STYLES[reserved-word]='fg=#4d9375'
ZSH_HIGHLIGHT_STYLES[hashed-command]='fg=#4d9375'
## Punctuation
ZSH_HIGHLIGHT_STYLES[commandseparator]='fg=#cb7676'
ZSH_HIGHLIGHT_STYLES[command-substitution-delimiter]='fg=#444444'
ZSH_HIGHLIGHT_STYLES[command-substitution-delimiter-unquoted]='fg=#444444'
ZSH_HIGHLIGHT_STYLES[process-substitution-delimiter]='fg=#444444'
ZSH_HIGHLIGHT_STYLES[back-quoted-argument-delimiter]='fg=#cb7676'
ZSH_HIGHLIGHT_STYLES[back-double-quoted-argument]='fg=#cb7676'
ZSH_HIGHLIGHT_STYLES[back-dollar-quoted-argument]='fg=#cb7676'
## Serializable / Configuration Languages
## Storage
## Strings
ZSH_HIGHLIGHT_STYLES[command-substitution-quoted]='fg=#c98a7d'
ZSH_HIGHLIGHT_STYLES[command-substitution-delimiter-quoted]='fg=#c98a7d'
ZSH_HIGHLIGHT_STYLES[single-quoted-argument]='fg=#c98a7d'
ZSH_HIGHLIGHT_STYLES[single-quoted-argument-unclosed]='fg=#fdaeb7'
ZSH_HIGHLIGHT_STYLES[double-quoted-argument]='fg=#c98a7d'
ZSH_HIGHLIGHT_STYLES[double-quoted-argument-unclosed]='fg=#fdaeb7'
ZSH_HIGHLIGHT_STYLES[rc-quote]='fg=#c98a7d'
## Variables
ZSH_HIGHLIGHT_STYLES[dollar-quoted-argument]='fg=#bd976a'
ZSH_HIGHLIGHT_STYLES[dollar-quoted-argument-unclosed]='fg=#fdaeb7'
ZSH_HIGHLIGHT_STYLES[dollar-double-quoted-argument]='fg=#bd976a'
ZSH_HIGHLIGHT_STYLES[assign]='fg=#bd976a'
ZSH_HIGHLIGHT_STYLES[named-fd]='fg=#dbd7ca'
ZSH_HIGHLIGHT_STYLES[numeric-fd]='fg=#4c9a91'
## No category relevant in spec
ZSH_HIGHLIGHT_STYLES[unknown-token]='fg=#fdaeb7'
ZSH_HIGHLIGHT_STYLES[path]='fg=#dbd7ca,underline'
ZSH_HIGHLIGHT_STYLES[path_pathseparator]='fg=#cb7676,underline'
ZSH_HIGHLIGHT_STYLES[path_prefix]='fg=#dbd7ca,underline'
ZSH_HIGHLIGHT_STYLES[path_prefix_pathseparator]='fg=#cb7676,underline'
ZSH_HIGHLIGHT_STYLES[globbing]='fg=#c99076'
ZSH_HIGHLIGHT_STYLES[history-expansion]='fg=#6394bf'
#ZSH_HIGHLIGHT_STYLES[command-substitution]='fg=?'
#ZSH_HIGHLIGHT_STYLES[command-substitution-unquoted]='fg=?'
#ZSH_HIGHLIGHT_STYLES[process-substitution]='fg=?'
#ZSH_HIGHLIGHT_STYLES[arithmetic-expansion]='fg=?'
ZSH_HIGHLIGHT_STYLES[back-quoted-argument-unclosed]='fg=#fdaeb7'
ZSH_HIGHLIGHT_STYLES[redirection]='fg=#cb7676'
ZSH_HIGHLIGHT_STYLES[arg0]='fg=#dbd7ca'
ZSH_HIGHLIGHT_STYLES[default]='fg=#dbd7ca'
ZSH_HIGHLIGHT_STYLES[cursor]='fg=#dbd7ca'
