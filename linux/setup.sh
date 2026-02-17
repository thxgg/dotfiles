#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PACKAGES_DIR="$SCRIPT_DIR/packages"

DRY_RUN=0
WITH_VIRTUALIZATION=0
PROFILES=()

usage() {
	cat <<'EOF'
Usage: ./linux/setup.sh [options]

Options:
  --dry-run                Print install commands only
  --with-virtualization    Include virtualization profile
  --profiles a,b,c         Override profiles to install
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
				echo "Missing value for --profiles"
				exit 1
			fi
			PROFILES=("${(@s:,:)2}")
			shift 2
			;;
		--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1"
			usage
			exit 1
			;;
	esac
done

if [[ ! -f /etc/arch-release ]]; then
	echo "This setup only supports Arch Linux."
	exit 1
fi

if ! command -v yay &>/dev/null; then
	echo "yay is required but was not found in PATH."
	exit 1
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
		echo "Profile file not found: $profile_file"
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
	echo "No packages resolved from selected profiles."
	exit 1
fi

echo "Resolved profiles: ${PROFILES[*]}"
echo "Resolved package count: ${#unique_packages[@]}"

if [[ $DRY_RUN -eq 1 ]]; then
	echo "Dry run package list:"
	printf ' - %s\n' "${unique_packages[@]}"
	echo "Dry run command:"
	printf 'yay -S --needed --noconfirm'
	printf ' %q' "${unique_packages[@]}"
	printf '\n'
	exit 0
fi

echo "Installing packages with yay..."
yay -S --needed --noconfirm "${unique_packages[@]}"

enable_service() {
	local service="$1"
	if [[ -n "$(systemctl list-unit-files "$service" --no-legend 2>/dev/null)" ]]; then
		echo "Enabling service: $service"
		sudo systemctl enable --now "$service"
	else
		echo "Service not found, skipping: $service"
	fi
}

echo "Running post-install service setup..."
enable_service docker.service
enable_service redis.service
enable_service tailscaled.service
enable_service postgresql18.service
enable_service postgresql.service

if command -v fnm &>/dev/null; then
	echo "Setting up Node.js versions with fnm..."
	eval "$(fnm env --use-on-cd)"
	fnm install 14
	fnm install 17
	fnm install lts
	fnm default lts-latest
fi

if command -v pipx &>/dev/null; then
	echo "Setting up pipx path..."
	pipx ensurepath
fi

echo "Linux setup complete."
