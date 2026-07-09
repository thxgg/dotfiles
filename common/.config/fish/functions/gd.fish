function gd
    if test (count $argv) -eq 0
        git diff --color | diff-so-fancy
    else
        git diff --color $argv | diff-so-fancy
    end
end
