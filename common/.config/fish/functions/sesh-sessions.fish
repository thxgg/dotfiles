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
