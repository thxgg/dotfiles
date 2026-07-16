#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PACKAGES_DIR="$SCRIPT_DIR/packages"

DRY_RUN=0
WITH_VIRTUALIZATION=0
SKIP_NETWORK_CHECK="${SKIP_NETWORK_CHECK:-0}"
SUDO_KEEPALIVE_PID=""
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

current_login_shell() {
	if command -v getent >/dev/null 2>&1; then
		getent passwd "$USER" | cut -d: -f7
		return
	fi

	printf '%s\n' "${SHELL:-}"
}

configure_fish_shell() {
	local fish_path current_shell

	if ! command -v fish >/dev/null 2>&1; then
		warn "fish not found in PATH; skipping login shell migration"
		return
	fi

	fish_path="$(command -v fish)"
	current_shell="$(current_login_shell)"

	if [[ "$current_shell" == "$fish_path" ]]; then
		success "Login shell already set to fish ($fish_path)"
		return
	fi

	if [[ -r /etc/shells ]] && ! grep -Fxq "$fish_path" /etc/shells; then
		warn "fish path is missing from /etc/shells: $fish_path"
		warn "Add it to /etc/shells, then run: chsh -s $fish_path"
		return
	fi

	if [[ ! -t 0 || ! -t 1 ]]; then
		warn "Login shell is still ${current_shell:-unknown}; run: chsh -s $fish_path"
		return
	fi

	if ! command -v chsh >/dev/null 2>&1; then
		warn "chsh not found; set your login shell manually: $fish_path"
		return
	fi

	info "Updating login shell to fish: $fish_path"
	if chsh -s "$fish_path"; then
		success "Login shell updated to fish"
	else
		warn "Automatic login shell change failed; run manually: chsh -s $fish_path"
	fi
}

configure_pacman_ignored_packages() {
	local pacman_conf="/etc/pacman.conf"

	if awk '$1 == "IgnorePkg" { for (i = 3; i <= NF; i++) if ($i == "flameshot") found = 1 } END { exit !found }' "$pacman_conf"; then
		success "Pacman already ignores flameshot updates"
		return
	fi

	info "Configuring pacman and yay to ignore flameshot updates"
	if grep -Eq '^[[:space:]]*IgnorePkg[[:space:]]*=' "$pacman_conf"; then
		sudo sed -i '0,/^[[:space:]]*IgnorePkg[[:space:]]*=/s/$/ flameshot/' "$pacman_conf"
	else
		sudo sed -i '/^[[:space:]]*\[options\][[:space:]]*$/a IgnorePkg = flameshot' "$pacman_conf"
	fi
	success "Pacman and yay will ignore flameshot updates"
}

ensure_vite_plus_node() {
	local vp_home vp_bin

	vp_home="${VP_HOME:-$HOME/.vite-plus}"
	vp_bin="$vp_home/bin/vp"

	if ! command -v vp >/dev/null 2>&1 && [[ ! -x "$vp_bin" ]]; then
		if ! command -v curl >/dev/null 2>&1; then
			warn "curl not found; skipping Vite+ installation"
			return
		fi

		info "Installing Vite+"
		curl -fsSL https://vite.plus | env VP_NODE_MANAGER=yes bash
	fi

	if command -v vp >/dev/null 2>&1; then
		vp_bin="$(command -v vp)"
	elif [[ -x "$vp_bin" ]]; then
		export PATH="${vp_bin:h}:$PATH"
	else
		warn "Vite+ not found; skipping Node.js setup"
		return
	fi

	info "Setting up Node.js versions with Vite+"
	VP_NODE_MANAGER=yes "$vp_bin" env setup --refresh
	"$vp_bin" env on
	"$vp_bin" env install 14 || warn "Could not install legacy Node.js 14 with Vite+; continuing"
	"$vp_bin" env install 17 || warn "Could not install legacy Node.js 17 with Vite+; continuing"
	"$vp_bin" env install lts
	"$vp_bin" env default lts
}

ensure_open_computer_use() {
	if ! command -v npm >/dev/null 2>&1; then
		warn "npm not found; skipping Open Computer Use installation"
		return
	fi

	info "Installing Open Computer Use"
	npm install --global open-computer-use
}

ensure_amp() {
	if ! command -v curl >/dev/null 2>&1; then
		warn "curl not found; skipping Amp installation"
		return
	fi

	info "Installing or updating Amp with the official binary installer"
	curl -fsSL https://ampcode.com/install.sh | bash
}

replace_package_if_needed() {
	local old_name="$1"
	local new_name="$2"
	local i

	for ((i = 1; i <= ${#packages[@]}; i++)); do
		if [[ "${packages[i]}" == "$old_name" ]]; then
			packages[i]="$new_name"
		fi
	done
}

normalize_package_aliases() {
	if ! pacman -Si redis >/dev/null 2>&1 && pacman -Si valkey >/dev/null 2>&1; then
		replace_package_if_needed redis valkey
	fi
}

package_is_requested() {
	local package_name="$1"
	local pkg

	for pkg in "${unique_packages[@]}"; do
		if [[ "$pkg" == "$package_name" ]]; then
			return 0
		fi
	done

	return 1
}

first_installed_package_matching() {
	local pattern="$1"
	local package_name

	while IFS= read -r package_name; do
		[[ "$package_name" =~ $pattern ]] || continue
		printf '%s\n' "$package_name"
		return 0
	done < <(pacman -Qq 2>/dev/null)

	return 0
}

collect_installed_packages() {
	local installed_packages=()
	local pkg

	for pkg in "$@"; do
		if pacman -Q "$pkg" >/dev/null 2>&1; then
			installed_packages+=("$pkg")
		fi
	done

	printf '%s\n' "${installed_packages[@]}"
}

remove_conflicting_packages() {
	local message="$1"
	local manual_command="$2"
	shift 2

	local conflicting_packages=("$@")

	if [[ ${#conflicting_packages[@]} -eq 0 ]]; then
		return
	fi

	warn "$message"
	warn "Installed package(s) in the way: ${conflicting_packages[*]}"

	if [[ ! -t 0 || ! -t 1 ]]; then
		error "$manual_command"
		exit 1
	fi

	info "Removing conflicting package(s): ${conflicting_packages[*]}"
	sudo pacman -Rns --noconfirm "${conflicting_packages[@]}"
}

reconcile_valkey_conflict() {
	local redis_variants=(${(@f)"$(collect_installed_packages redis redis-debug)"})

	if ! package_is_requested valkey; then
		return 0
	fi

	if [[ ${#redis_variants[@]} -eq 0 ]]; then
		return 0
	fi

	if pacman -Q valkey >/dev/null 2>&1; then
		return 0
	fi

	remove_conflicting_packages \
		"Arch now installs valkey instead of redis" \
		"Run 'sudo pacman -Rns ${redis_variants[*]} && sudo pacman -S valkey' first, then re-run setup" \
		"${redis_variants[@]}"
}

reconcile_flameshot_conflict() {
	local flameshot_variants=(${(@f)"$(collect_installed_packages flameshot-git flameshot-git-debug)"})

	if ! package_is_requested flameshot; then
		return 0
	fi

	if [[ ${#flameshot_variants[@]} -eq 0 ]]; then
		return 0
	fi

	if pacman -Q flameshot >/dev/null 2>&1; then
		return 0
	fi

	remove_conflicting_packages \
		"Repo flameshot conflicts with your installed flameshot-git variant" \
		"Run 'sudo pacman -Rns ${flameshot_variants[*]}' first, then re-run setup" \
		"${flameshot_variants[@]}"
}

reconcile_nodejs_provider_conflict() {
	local lts_provider

	if ! package_is_requested heroku-cli; then
		return 0
	fi

	lts_provider="$(first_installed_package_matching '^nodejs-lts-')"
	if [[ -z "$lts_provider" ]] || pacman -Q nodejs >/dev/null 2>&1; then
		return 0
	fi

	warn "heroku-cli now requires the current nodejs package"
	warn "Installed provider $lts_provider conflicts with nodejs"

	if [[ ! -t 0 || ! -t 1 ]]; then
		error "Run 'sudo pacman -Rdd $lts_provider && sudo pacman -S nodejs npm' first, then re-run setup"
		exit 1
	fi

	info "Switching system Node.js provider from $lts_provider to nodejs"
	sudo pacman -Rdd --noconfirm "$lts_provider"
	sudo pacman -S --needed --noconfirm nodejs npm
}

ensure_sudo_session() {
	if [[ -n "$SUDO_KEEPALIVE_PID" ]] && kill -0 "$SUDO_KEEPALIVE_PID" >/dev/null 2>&1; then
		return 0
	fi

	if ! command -v sudo >/dev/null 2>&1; then
		error "sudo is required for package and service setup"
		exit 1
	fi

	if [[ ! -t 0 || ! -t 1 ]]; then
		error "Interactive sudo access is required; run this script from a terminal"
		exit 1
	fi

	info "Authenticating sudo once up front (password input is hidden while typing)"
	sudo -v

	while true; do
		sudo -n true >/dev/null 2>&1 || exit
		sleep 50
		kill -0 $$ >/dev/null 2>&1 || exit
	done &
	SUDO_KEEPALIVE_PID=$!
}

initialize_postgresql18_cluster() {
	local pgdata="/var/lib/postgres/data18"
	local initdb_bin="/opt/postgresql18/bin/initdb"

	if ! package_is_requested postgresql18; then
		return 0
	fi

	if systemctl is-active --quiet postgresql18.service; then
		success "PostgreSQL 18 service already running"
		return 0
	fi

	if sudo test -f "$pgdata/PG_VERSION"; then
		success "PostgreSQL 18 cluster already initialized ($pgdata)"
		return 0
	fi

	if sudo test -d "$pgdata" && sudo find "$pgdata" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
		warn "PostgreSQL 18 data directory already exists and is non-empty; skipping initdb: $pgdata"
		return 0
	fi

	if [[ ! -x "$initdb_bin" ]]; then
		warn "postgresql18 initdb binary not found, skipping cluster initialization: $initdb_bin"
		return 0
	fi

	info "Initializing PostgreSQL 18 cluster: $pgdata"
	sudo install -d -m 700 -o postgres -g postgres /var/lib/postgres
	sudo -u postgres "$initdb_bin" -D "$pgdata"
}

cleanup() {
	local ret=$?

	if [[ -n "$SUDO_KEEPALIVE_PID" ]]; then
		kill "$SUDO_KEEPALIVE_PID" >/dev/null 2>&1 || true
		wait "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
	fi

	if [[ $ret -ne 0 ]]; then
		error "Linux setup failed"
	fi

	exit $ret
}

trap cleanup EXIT

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

normalize_package_aliases

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
	info "Dry run post-install command:"
	printf 'curl -fsSL https://ampcode.com/install.sh | bash\n'
	success "Dry run complete"
	exit 0
fi

info "Installing packages with yay"
ensure_sudo_session
configure_pacman_ignored_packages
reconcile_valkey_conflict
reconcile_flameshot_conflict
reconcile_nodejs_provider_conflict
yay -S --needed --noconfirm --answerclean N --answerdiff N --answeredit N "${unique_packages[@]}"

enable_service() {
	local service="$1"
	local unit_entry enabled_state

	unit_entry="$(systemctl list-unit-files "$service" --no-legend 2>/dev/null | head -n 1)"
	if [[ -z "$unit_entry" ]]; then
		warn "Service not found, skipping: $service"
		return
	fi

	enabled_state="$(systemctl is-enabled "$service" 2>/dev/null || true)"
	if [[ "$enabled_state" == "alias" ]]; then
		info "Service is an alias, starting without enabling: $service"
		sudo systemctl start "$service"
		return
	fi

	info "Enabling service: $service"
	sudo systemctl enable --now "$service"
}

disable_service() {
	local service="$1"

	if ! systemctl list-unit-files "$service" --no-legend &>/dev/null; then
		warn "Service not found, skipping: $service"
		return
	fi

	info "Disabling service: $service"
	sudo systemctl disable --now "$service"
}

info "Running post-install service setup"
enable_service docker.service
enable_service valkey.service
enable_service redis.service
disable_service tailscaled.service

if package_is_requested postgresql18; then
	initialize_postgresql18_cluster
	enable_service postgresql18.service
fi

if package_is_requested postgresql; then
	enable_service postgresql.service
fi

configure_fish_shell

ensure_vite_plus_node
ensure_open_computer_use
ensure_amp

if command -v pipx &>/dev/null; then
	info "Ensuring pipx path setup"
	pipx ensurepath
fi

success "Linux setup complete"
