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

current_login_shell() {
	if command -v dscl >/dev/null 2>&1; then
		dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk '{print $2}'
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

set_launchservices_extension_handler() {
	local extension="${1#.}"
	local bundle_id="$2"
	local plist="$HOME/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
	local count idx existing_tag existing_class

	if [[ -z "$extension" ]]; then
		return
	fi

	mkdir -p "${plist:h}"

	if [[ ! -f "$plist" ]]; then
		plutil -create xml1 "$plist"
	fi

	if ! plutil -extract LSHandlers raw -expect array "$plist" >/dev/null 2>&1; then
		plutil -insert LSHandlers -array "$plist" >/dev/null
	fi

	count="$(plutil -extract LSHandlers raw -expect array "$plist" 2>/dev/null || printf '0')"
	for (( idx = count - 1; idx >= 0; idx-- )); do
		existing_tag="$(plutil -extract "LSHandlers.$idx.LSHandlerContentTag" raw -expect string "$plist" 2>/dev/null || true)"
		existing_class="$(plutil -extract "LSHandlers.$idx.LSHandlerContentTagClass" raw -expect string "$plist" 2>/dev/null || true)"

		if [[ "$existing_tag" == "$extension" && "$existing_class" == "public.filename-extension" ]]; then
			plutil -remove "LSHandlers.$idx" "$plist" >/dev/null
		fi
	done

	count="$(plutil -extract LSHandlers raw -expect array "$plist")"
	plutil -insert "LSHandlers.$count" -dictionary "$plist" >/dev/null
	plutil -insert "LSHandlers.$count.LSHandlerContentTag" -string "$extension" "$plist" >/dev/null
	plutil -insert "LSHandlers.$count.LSHandlerContentTagClass" -string "public.filename-extension" "$plist" >/dev/null
	plutil -insert "LSHandlers.$count.LSHandlerRoleAll" -string "$bundle_id" "$plist" >/dev/null
}

set_launchservices_content_type_handler() {
	local content_type="$1"
	local bundle_id="$2"
	local plist="$HOME/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
	local count idx existing_type

	if [[ -z "$content_type" || "$content_type" == "(null)" ]]; then
		return
	fi

	mkdir -p "${plist:h}"

	if [[ ! -f "$plist" ]]; then
		plutil -create xml1 "$plist"
	fi

	if ! plutil -extract LSHandlers raw -expect array "$plist" >/dev/null 2>&1; then
		plutil -insert LSHandlers -array "$plist" >/dev/null
	fi

	count="$(plutil -extract LSHandlers raw -expect array "$plist" 2>/dev/null || printf '0')"
	for (( idx = count - 1; idx >= 0; idx-- )); do
		existing_type="$(plutil -extract "LSHandlers.$idx.LSHandlerContentType" raw -expect string "$plist" 2>/dev/null || true)"

		if [[ "$existing_type" == "$content_type" ]]; then
			plutil -remove "LSHandlers.$idx" "$plist" >/dev/null
		fi
	done

	count="$(plutil -extract LSHandlers raw -expect array "$plist")"
	plutil -insert "LSHandlers.$count" -dictionary "$plist" >/dev/null
	plutil -insert "LSHandlers.$count.LSHandlerContentType" -string "$content_type" "$plist" >/dev/null
	plutil -insert "LSHandlers.$count.LSHandlerRoleAll" -string "$bundle_id" "$plist" >/dev/null
}

configure_vscode_file_associations() {
	local vscode_bundle_id="com.microsoft.VSCode"
	local vscode_app_found=0
	local extension extension_name tmp_file content_type uti
	local -a extensions utis

	if ! command -v duti >/dev/null 2>&1; then
		warn "duti not found; skipping VS Code file association setup"
		return
	fi

	if [[ -d "/Applications/Visual Studio Code.app" || -d "$HOME/Applications/Visual Studio Code.app" ]]; then
		vscode_app_found=1
	elif command -v mdfind >/dev/null 2>&1 && mdfind "kMDItemCFBundleIdentifier == '$vscode_bundle_id'" | grep -q .; then
		vscode_app_found=1
	fi

	if [[ "$vscode_app_found" != "1" ]]; then
		warn "Visual Studio Code not found; skipping file association setup"
		return
	fi

	if [[ -x "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" ]]; then
		/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Visual Studio Code.app" >/dev/null 2>&1 || true
	fi

	extensions=(
		.c .cc .cpp .cxx .h .hh .hpp .hxx .m .mm .metal .swift
		.rs .go .py .rb .php .java .kt .kts .scala .cs
		.js .jsx .ts .tsx .mjs .cjs .vue .svelte
		.css .scss .sass .less
		.sh .bash .zsh .fish .ps1 .bat .cmd
		.sql .graphql .gql .proto
		.md .mdx .txt .text .log .csv .tsv
		.json .jsonc .json5 .yaml .yml .toml .xml .plist .ini .conf .cfg .properties
		.env .editorconfig .gitignore .gitattributes .dockerignore
	)

	utis=(
		public.text
		public.plain-text
		public.source-code
		public.script
		public.shell-script
		public.json
		public.yaml
		public.xml
		com.apple.property-list
		net.daringfireball.markdown
	)

	info "Setting VS Code as default for text, code, and config files"
	for extension in "${extensions[@]}"; do
		if ! duti -s "$vscode_bundle_id" "$extension" all >/dev/null 2>&1; then
			set_launchservices_extension_handler "$extension" "$vscode_bundle_id"
			extension_name="${extension#.}"
			tmp_file="$(mktemp "${TMPDIR:-/tmp}/vscode-association.XXXXXX.$extension_name")"
			content_type="$(mdls -name kMDItemContentType -raw "$tmp_file" 2>/dev/null || true)"
			rm -f "$tmp_file"
			set_launchservices_content_type_handler "$content_type" "$vscode_bundle_id"
		fi
	done

	for uti in "${utis[@]}"; do
		if ! duti -s "$vscode_bundle_id" "$uti" all >/dev/null 2>&1; then
			warn "Could not set VS Code default for $uti"
		fi
	done
	killall cfprefsd >/dev/null 2>&1 || true
	success "VS Code file associations configured"
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

configure_fish_shell
configure_vscode_file_associations

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
	fnm install lts-latest
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
