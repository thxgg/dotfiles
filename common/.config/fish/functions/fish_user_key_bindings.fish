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
