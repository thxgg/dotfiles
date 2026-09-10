function glp
    if test (count $argv) -ne 1; or not string match -qr '^[1-9][0-9]*$' -- "$argv[1]"
        echo 'usage: glp <positive integer>' >&2
        return 1
    end

    git --no-pager log -$argv[1]
end
