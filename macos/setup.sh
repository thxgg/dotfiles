#!/usr/bin/env zsh

SCRIPT_DIR="${0:A:h}"
BREWFILE="$SCRIPT_DIR/Brewfile"

# Install homebrew if missing
if ! command -v brew &>/dev/null; then
	echo "🍺 Homebrew not found. Installing..."
	/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install homebrew dependencies
export NONINTERACTIVE=1 # see https://docs.brew.sh/Installation#unattended-installation

# Add Homebrew to PATH (especially important for Apple Silicon Macs)
if [[ $(uname -m) == 'arm64' ]]; then
	eval "$(/opt/homebrew/bin/brew shellenv)"
else
	eval "$(/usr/local/bin/brew shellenv)"
fi

# Update Homebrew
echo "🔄 Updating Homebrew..."
brew update

# Upgrade any already-installed formulae
echo "⬆️  Upgrading existing formulae..."
brew upgrade

# Install dependencies from Brewfile
if [[ ! -f "$BREWFILE" ]]; then
	echo "Error: Brewfile not found at $BREWFILE"
	exit 1
fi

echo "📦 Installing dependencies from Brewfile..."
brew bundle --file="$BREWFILE"

# Post-installation setup for specific formulae
echo "🔧 Running post-installation setup..."

# PostgreSQL setup
if brew services list | grep -q postgresql@18; then
	echo "Starting PostgreSQL service..."
	brew services start postgresql@18
fi

# Redis setup
if brew services list | grep -q redis; then
	echo "Starting Redis service..."
	brew services start redis
fi

# Node.js setup with fnm
if command -v fnm &>/dev/null; then
	echo "Setting up Node.js environment..."
	eval "$(fnm env --use-on-cd)"
	fnm install 14
	fnm install 17
	fnm install lts
	fnm default lts-latest
fi

# Python CLI setup with pipx
if command -v pipx &>/dev/null; then
	echo "Setting up pipx path..."
	pipx ensurepath
fi

# Cleanup
echo "🧹 Cleaning up..."
brew cleanup

# Set default java version
export JAVA_HOME=$(/usr/libexec/java_home -v 21)

echo "✅ Installation complete!"
