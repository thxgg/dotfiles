#!/usr/bin/env zsh

# Read-only checks. The caller supplies print_status and the package manifest.
dotfiles_check_pi_transcribe() {
    local manifest="$1"
    local agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
    [[ "$agent_dir" == '~/'* ]] && agent_dir="$HOME/${agent_dir#\~/}"
    local settings_file="$agent_dir/settings.json"
    local transcribe_file="$agent_dir/pi-transcribe.json"
    local package_dir="$agent_dir/git/github.com/earendil-works/pi-transcribe"
    local expected_source expected_ref actual_ref model_path

    if command -v "${PI_TRANSCRIBE_FFMPEG_PATH:-ffmpeg}" >/dev/null 2>&1; then
        print_status OK "Pi Transcribe FFmpeg is available"
    else
        print_status WARN "Pi Transcribe file transcription needs FFmpeg; install it through the OS package manifest"
    fi

    if ! command -v jq >/dev/null 2>&1; then
        print_status WARN "jq is unavailable; cannot check Pi Transcribe settings"
        return
    fi

    expected_source="$(grep '^https://github.com/earendil-works/pi-transcribe@' "$manifest" || true)"
    expected_ref="${expected_source##*@}"
    actual_ref="$(git -C "$package_dir" rev-parse HEAD 2>/dev/null || true)"
    if [[ -n "$expected_source" && -f "$package_dir/package.json" && -d "$package_dir/node_modules" && "$actual_ref" == "$expected_ref" ]] &&
        jq -e --arg source "$expected_source" \
            'any(.packages[]?; (if type == "string" then . else .source end) == $source)' \
            "$settings_file" >/dev/null 2>&1; then
        print_status OK "Pi Transcribe package is installed at the declared commit"
    else
        print_status WARN "Pi Transcribe package is missing or differs from the manifest; run zsh scripts/install-pi-packages.zsh"
    fi

    if [[ ! -f "$transcribe_file" ]]; then
        print_status WARN "Pi Transcribe is not configured; run /transcribe in Pi"
        return
    fi
    if ! model_path="$(jq -er '.model.path | select(type == "string" and length > 0)' "$transcribe_file" 2>/dev/null)"; then
        print_status WARN "Pi Transcribe model path is invalid; run /transcribe in Pi"
    elif [[ -f "$model_path" ]]; then
        print_status OK "Pi Transcribe configured model file exists"
    else
        print_status WARN "Pi Transcribe configured model file is missing; run /transcribe in Pi"
    fi
}
