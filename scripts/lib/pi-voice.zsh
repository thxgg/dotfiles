#!/usr/bin/env zsh

# Read-only checks. The caller supplies print_status and the package manifest.
dotfiles_check_pi_voice() {
    local manifest="$1"
    local agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
    [[ "$agent_dir" == '~/'* ]] && agent_dir="$HOME/${agent_dir#\~/}"
    local settings_file="$agent_dir/settings.json"
    local voice_file="$agent_dir/pi-voice.json"
    local package_dir="$agent_dir/npm/node_modules/@earendil-works/pi-voice"
    local expected_version actual_version model_path

    if command -v "${PI_VOICE_FFMPEG_PATH:-${PI_TRANSCRIBE_FFMPEG_PATH:-ffmpeg}}" >/dev/null 2>&1; then
        print_status OK "Pi Voice FFmpeg is available"
    else
        print_status WARN "Pi Voice file transcription needs FFmpeg; install it through the OS package manifest"
    fi

    if ! command -v jq >/dev/null 2>&1; then
        print_status WARN "jq is unavailable; cannot check Pi Voice settings"
        return
    fi

    expected_version="$(jq -r '.dependencies["@earendil-works/pi-voice"] // empty' "$manifest" 2>/dev/null || true)"
    actual_version="$(jq -r '.version // empty' "$package_dir/package.json" 2>/dev/null || true)"
    if [[ -n "$expected_version" && "$actual_version" == "$expected_version" ]] &&
        jq -e --arg source "npm:@earendil-works/pi-voice@$expected_version" \
            'any(.packages[]?; (if type == "string" then . else .source end) == $source)' \
            "$settings_file" >/dev/null 2>&1; then
        print_status OK "Pi Voice package is installed at the declared version"
    else
        print_status WARN "Pi Voice package is missing or differs from the manifest; run zsh scripts/install-pi-packages.zsh"
    fi

    # Pi Voice migrates legacy settings itself on first use. Do not mutate them here.
    if [[ ! -f "$voice_file" && -f "$agent_dir/pi-transcribe.json" ]]; then
        voice_file="$agent_dir/pi-transcribe.json"
    fi
    if [[ ! -f "$voice_file" ]]; then
        print_status WARN "Pi Voice is not configured; run /voice-settings in Pi"
        return
    fi
    if ! model_path="$(jq -er '.model.path | select(type == "string" and length > 0)' "$voice_file" 2>/dev/null)"; then
        print_status WARN "Pi Voice model path is invalid; run /voice-settings in Pi"
    elif [[ -f "$model_path" ]]; then
        print_status OK "Pi Voice configured model file exists"
    else
        print_status WARN "Pi Voice configured model file is missing; run /voice-settings in Pi"
    fi
}
