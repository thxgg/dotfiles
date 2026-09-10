function gsha
    set -l sha (git rev-parse HEAD 2>/dev/null); or return 1

    if type -q pbcopy
        printf '%s' "$sha" | pbcopy; or return $status
        printf '%s\n' "$sha"
        return 0
    end

    if type -q wl-copy
        printf '%s' "$sha" | wl-copy; or return $status
        printf '%s\n' "$sha"
        return 0
    end

    if type -q xclip
        printf '%s' "$sha" | xclip -selection clipboard; or return $status
        printf '%s\n' "$sha"
        return 0
    end

    printf '%s\n' "$sha"
end
