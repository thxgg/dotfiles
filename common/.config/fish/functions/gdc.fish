function gdc
    if test (count $argv) -eq 0
        git diff --color --cached | diff-so-fancy
    else
        git diff --color --cached $argv | diff-so-fancy
    end
end
