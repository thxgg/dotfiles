#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
BREWFILE="$SCRIPT_DIR/Brewfile"
SKIP_NETWORK_CHECK="${SKIP_NETWORK_CHECK:-0}"

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
trap 'ret=$?; if [[ $ret -ne 0 ]]; then error "macOS setup failed"; fi; exit $ret' EXIT

check_network() {
	if [[ "$SKIP_NETWORK_CHECK" == "1" ]]; then
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
		error "Set SKIP_NETWORK_CHECK=1 to bypass"
		exit 1
	fi
}

load_brew_shellenv() {
	if [[ -x "/opt/homebrew/bin/brew" ]]; then
		eval "$(/opt/homebrew/bin/brew shellenv)"
	elif [[ -x "/usr/local/bin/brew" ]]; then
		eval "$(/usr/local/bin/brew shellenv)"
	elif command -v brew >/dev/null 2>&1; then
		eval "$(brew shellenv)"
	fi
}

if [[ "$OSTYPE" != "darwin"* ]]; then
	error "This script only supports macOS"
	exit 1
fi

if [[ ! -f "$BREWFILE" ]]; then
	error "Brewfile not found: $BREWFILE"
	exit 1
fi

check_network

# Install homebrew if missing
if ! command -v brew &>/dev/null; then
	info "Homebrew not found, installing"
	export NONINTERACTIVE=1
	/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

load_brew_shellenv

if ! command -v brew >/dev/null 2>&1; then
	error "Homebrew install failed or brew is still unavailable"
	exit 1
fi

# Install homebrew dependencies
export NONINTERACTIVE=1 # see https://docs.brew.sh/Installation#unattended-installation

# Update Homebrew
info "Updating Homebrew"
brew update

# Upgrade any already-installed formulae
info "Upgrading existing formulae"
brew upgrade

if brew bundle check --file="$BREWFILE" >/dev/null 2>&1; then
	success "Brewfile dependencies already installed"
else
	info "Installing dependencies from Brewfile"
	brew bundle --file="$BREWFILE"
fi

# Post-installation setup for specific formulae
info "Running post-installation setup"

# PostgreSQL setup
if brew list --formula | grep -qx "postgresql@18"; then
	info "Ensuring PostgreSQL service is running"
	brew services start postgresql@18
fi

# Redis setup
if brew list --formula | grep -qx "redis"; then
	info "Ensuring Redis service is running"
	brew services start redis
fi

# Node.js setup with fnm
if command -v fnm &>/dev/null; then
	info "Setting up Node.js versions with fnm"
	eval "$(fnm env --use-on-cd)"
	fnm install 14
	fnm install 17
	fnm install lts
	fnm default lts-latest
fi

# Python CLI setup with pipx
if command -v pipx &>/dev/null; then
	info "Ensuring pipx path setup"
	pipx ensurepath
fi

# Cleanup
info "Cleaning up Homebrew cache"
brew cleanup

# Set default java version
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"

success "macOS setup complete"
