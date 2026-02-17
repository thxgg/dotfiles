#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PACKAGES_DIR="$SCRIPT_DIR/packages"

DRY_RUN=0
WITH_VIRTUALIZATION=0
SKIP_NETWORK_CHECK="${SKIP_NETWORK_CHECK:-0}"
PROFILES=()

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
trap 'ret=$?; if [[ $ret -ne 0 ]]; then error "Linux setup failed"; fi; exit $ret' EXIT

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
		error "Use --skip-network-check to bypass"
		exit 1
	fi
}

usage() {
	cat <<'EOF'
Usage: ./linux/setup.sh [options]

Options:
  --dry-run                Print install commands only
  --with-virtualization    Include virtualization profile
  --profiles a,b,c         Override profiles to install
  --skip-network-check     Skip connectivity preflight check
  --help                   Show this help

Default profiles:
  core-cli,core-apps,desktop-hyprland
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--dry-run)
			DRY_RUN=1
			shift
			;;
		--with-virtualization)
			WITH_VIRTUALIZATION=1
			shift
			;;
		--profiles)
			if [[ $# -lt 2 ]]; then
				error "Missing value for --profiles"
				exit 1
			fi
			PROFILES=("${(@s:,:)2}")
			shift 2
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

if [[ ! -f /etc/arch-release ]]; then
	error "This setup only supports Arch Linux"
	exit 1
fi

if ! command -v yay &>/dev/null; then
	error "yay is required but was not found in PATH"
	exit 1
fi

if [[ ! -d "$PACKAGES_DIR" ]]; then
	error "Packages directory not found: $PACKAGES_DIR"
	exit 1
fi

if [[ $DRY_RUN -eq 0 ]]; then
	check_network
fi

if [[ ${#PROFILES[@]} -eq 0 ]]; then
	PROFILES=(core-cli core-apps desktop-hyprland)
	if [[ $WITH_VIRTUALIZATION -eq 1 ]]; then
		PROFILES+=(virtualization)
	fi
fi

packages=()
for profile in "${PROFILES[@]}"; do
	profile_file="$PACKAGES_DIR/$profile.txt"
	if [[ ! -f "$profile_file" ]]; then
		error "Profile file not found: $profile_file"
		exit 1
	fi

	while IFS= read -r line || [[ -n "$line" ]]; do
		line="${line%%#*}"
		line="${line#${line%%[![:space:]]*}}"
		line="${line%${line##*[![:space:]]}}"
		[[ -z "$line" ]] && continue
		packages+=("$line")
	done <"$profile_file"
done

unique_packages=(${(u)packages})

if [[ ${#unique_packages[@]} -eq 0 ]]; then
	error "No packages resolved from selected profiles"
	exit 1
fi

info "Resolved profiles: ${PROFILES[*]}"
info "Resolved package count: ${#unique_packages[@]}"

if [[ $DRY_RUN -eq 1 ]]; then
	info "Dry run package list:"
	printf ' - %s\n' "${unique_packages[@]}"
	info "Dry run command:"
	printf 'yay -S --needed --noconfirm'
	printf ' %q' "${unique_packages[@]}"
	printf '\n'
	success "Dry run complete"
	exit 0
fi

info "Installing packages with yay"
yay -S --needed --noconfirm "${unique_packages[@]}"

enable_service() {
	local service="$1"
	if [[ -n "$(systemctl list-unit-files "$service" --no-legend 2>/dev/null)" ]]; then
		info "Enabling service: $service"
		sudo systemctl enable --now "$service"
	else
		warn "Service not found, skipping: $service"
	fi
}

info "Running post-install service setup"
enable_service docker.service
enable_service redis.service
enable_service tailscaled.service
enable_service postgresql18.service
enable_service postgresql.service

if command -v fnm &>/dev/null; then
	info "Setting up Node.js versions with fnm"
	eval "$(fnm env --use-on-cd)"
	fnm install 14
	fnm install 17
	fnm install lts
	fnm default lts-latest
fi

if command -v pipx &>/dev/null; then
	info "Ensuring pipx path setup"
	pipx ensurepath
fi

success "Linux setup complete"
