function glp
    if test (count $argv) -eq 0
        echo 'usage: glp <count>' >&2
        return 1
    end

    git --no-pager log -$argv[1]
end
