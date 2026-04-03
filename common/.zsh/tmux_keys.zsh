# tmux_keys.zsh - Handle CSI-u extended key sequences in zsh
#
# When tmux is configured with `extended-keys always`, it sends CSI-u encoded
# sequences for modifier+key combos to ALL programs, not just those that request
# them. This means zsh receives raw escape sequences for keys like Shift+Enter
# that it wouldn't normally see.
#
# Without these bindings, Shift+Enter in zsh (inside tmux) would print the raw
# escape sequence instead of acting as Enter.
#
# These bindings only affect the zsh shell itself — TUI apps like pi that have
# their own CSI-u parsers handle these sequences natively.

if [[ -n "$TMUX" ]]; then
  # Shift+Enter (CSI-u: \e[13;2u) → accept line (same as Enter)
  bindkey '\e[13;2u' accept-line
  # Also handle the older xterm-style format tmux may use
  bindkey '\e[27;2;13~' accept-line
fi
