#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
CREATE_USER_DIRS=1
SKIP_NETWORK_CHECK=0

info() {
	printf '[INFO] %s\n' "$1"
}

success() {
	printf '[OK] %s\n' "$1"
}

warn() {
	printf '[WARN] %s\n' "$1"
}

error() {
	printf '[ERROR] %s\n' "$1" >&2
}

ret=0
trap 'ret=$?; if [[ $ret -ne 0 ]]; then error "Setup failed"; fi; exit $ret' EXIT

check_network() {
	if [[ $SKIP_NETWORK_CHECK -eq 1 ]]; then
		warn "Skipping network check"
		return
	fi

	if ! command -v curl >/dev/null 2>&1; then
		warn "curl not found; skipping network check"
		return
	fi

	if curl --silent --show-error --fail --head --max-time 5 https://github.com >/dev/null 2>&1; then
		success "Network check passed"
	else
		error "Network check failed (https://github.com unreachable)"
		error "Re-run with --skip-network-check if you're intentionally offline"
		exit 1
	fi
}

require_script() {
	local script_path="$1"
	if [[ ! -f "$script_path" ]]; then
		error "Required script not found: $script_path"
		exit 1
	fi
}

usage() {
	cat <<'EOF'
Usage: ./setup.sh [options]

Options:
  --skip-user-dirs  Skip creating personal directory scaffold
  --skip-network-check  Skip connectivity preflight check
  --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--skip-user-dirs)
			CREATE_USER_DIRS=0
			shift
			;;
		--skip-network-check)
			SKIP_NETWORK_CHECK=1
			shift
			;;
		--help)
			usage
			exit 0
			;;
		*)
			error "Unknown option: $1"
			usage
			exit 1
			;;
	esac
done

require_script "$SCRIPT_DIR/safe-stow.sh"

if [[ "$OSTYPE" == "darwin"* ]]; then
	require_script "$SCRIPT_DIR/macos/setup.sh"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
	require_script "$SCRIPT_DIR/linux/setup.sh"
else
	error "Unsupported operating system: $OSTYPE"
	exit 1
fi

check_network

if [[ $CREATE_USER_DIRS -eq 1 ]]; then
	USER_DIRS=(
		"$HOME/Downloads"
		"$HOME/Documents"
		"$HOME/Pictures"
		"$HOME/Music"
		"$HOME/Videos"
		"$HOME/Pictures/Wallpapers"
		"$HOME/Pictures/Screenshots"
		"$HOME/Projects/Personal"
		"$HOME/Projects/Work"
		"$HOME/Obsidian"
	)

	info "Creating user directories"
	for dir in "${USER_DIRS[@]}"; do
		if [[ ! -d "$dir" ]]; then
			info "Creating directory: $dir"
			mkdir -p "$dir"
		else
			info "Directory already exists: $dir"
		fi
	done
fi

info "Running OS-specific setup"
if [[ "$OSTYPE" == "darwin"* ]]; then
	info "macOS detected, running macOS setup script"
	SKIP_NETWORK_CHECK=$SKIP_NETWORK_CHECK zsh "$SCRIPT_DIR/macos/setup.sh"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
	info "Linux detected, running Linux setup script"
	SKIP_NETWORK_CHECK=$SKIP_NETWORK_CHECK zsh "$SCRIPT_DIR/linux/setup.sh"
fi

info "Applying stow links"
zsh "$SCRIPT_DIR/safe-stow.sh"
success "Setup completed"
