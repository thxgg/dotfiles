#!/usr/bin/env zsh

# Install homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

FORMULAE=(
	"fd"
	"fnm"
	"git"
	"hub"
	"lazydocker"
	"lazygit"
	"luarocks"
	"neovim"
	"openjdk@17"
	"openjdk@21"
	"openjdk@23"
	"pipx"
	"podman"
	"podman-compose"
	"postgresql@16"
	"python@3.13"
	"redis"
	"ripgrep"
	"starship"
	"stow"
	"wget"
)

CASKS=(
	"alacritty"
	"google-chrome"
	"rectangle"
	"arc"
	"hiddenbar"
	"slack"
	"discord"
	"intellij-idea"
	"stats"
	"docker"
	"obsidian"
	"topnotch"
	"dropbox"
	"podman-desktop"
	"visual-studio-code"
	"firefox"
	"raycast"
	"zed"
)

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

# Install formulae
echo "🍺 Installing formulae..."
for formula in "${FORMULAE[@]}"; do
	echo "  Installing $formula..."
	brew install "$formula"
done

# Install casks
echo "📦 Installing casks..."
for cask in "${CASKS[@]}"; do
	echo "  Installing $cask..."
	brew install --cask "$cask"
done

# Post-installation setup for specific formulae
echo "🔧 Running post-installation setup..."

# PostgreSQL setup
if brew services list | grep -q postgresql@16; then
	echo "Starting PostgreSQL service..."
	brew services start postgresql@16
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

# Cleanup
echo "🧹 Cleaning up..."
brew cleanup

# Python setup with pipx
if command -v pipx &>/dev/null; then
	echo "Setting up Python development environment..."
	pipx ensurepath
fi

# Set default java version
export JAVA_HOME=$(/usr/libexec/java_home -v 17)

echo "✅ Installation complete!"
