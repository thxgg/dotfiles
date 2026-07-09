function grt
    set -l git_root (git rev-parse --show-toplevel 2>/dev/null); or return
    cd "$git_root"
end
