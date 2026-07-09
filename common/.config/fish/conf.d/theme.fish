set -l __dotfiles_theme_mode dark
if test -x "$HOME/.local/bin/theme-mode"
    set __dotfiles_theme_mode ("$HOME/.local/bin/theme-mode" get 2>/dev/null)
end

if test "$__dotfiles_theme_mode" = light
    set -U fish_color_normal 4c4f69
    set -U fish_color_command 1e66f5
    set -U fish_color_keyword 7287fd
    set -U fish_color_quote 40a02b
    set -U fish_color_redirection ea76cb
    set -U fish_color_end fe640b
    set -U fish_color_error d20f39 --bold
    set -U fish_color_param 4c4f69
    set -U fish_color_valid_path 1e66f5 --underline
    set -U fish_color_option 179299
    set -U fish_color_comment 8c8fa1
    set -U fish_color_operator 7287fd
    set -U fish_color_escape fe640b
    set -U fish_color_autosuggestion 9ca0b0
    set -U fish_color_selection --background=ccd0da
    set -U fish_color_search_match --background=bcc0cc

    set -U fish_pager_color_completion 4c4f69
    set -U fish_pager_color_description 7c7f93
    set -U fish_pager_color_prefix 7287fd --bold
    set -U fish_pager_color_progress 8c8fa1
    set -U fish_pager_color_selected_background --background=ccd0da
    set -U fish_pager_color_selected_completion 4c4f69
    set -U fish_pager_color_selected_description 6c6f85
else
    set -U fish_color_normal cdd6f4
    set -U fish_color_command 89b4fa
    set -U fish_color_keyword b4befe
    set -U fish_color_quote a6e3a1
    set -U fish_color_redirection f5c2e7
    set -U fish_color_end fab387
    set -U fish_color_error f38ba8 --bold
    set -U fish_color_param cdd6f4
    set -U fish_color_valid_path 89b4fa --underline
    set -U fish_color_option 94e2d5
    set -U fish_color_comment 6c7086
    set -U fish_color_operator b4befe
    set -U fish_color_escape fab387
    set -U fish_color_autosuggestion 585b70
    set -U fish_color_selection --background=313244
    set -U fish_color_search_match --background=45475a

    set -U fish_pager_color_completion cdd6f4
    set -U fish_pager_color_description 9399b2
    set -U fish_pager_color_prefix b4befe --bold
    set -U fish_pager_color_progress 7f849c
    set -U fish_pager_color_selected_background --background=313244
    set -U fish_pager_color_selected_completion cdd6f4
    set -U fish_pager_color_selected_description bac2de
end
