#!/usr/bin/env zsh

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

# Create each directory if it doesn't exist
echo "Creating user directories..."
for dir in "${USER_DIRS[@]}"; do
	if [ ! -d "$dir" ]; then
		echo "Creating directory: $dir"
		mkdir -p "$dir"
	else
		echo "Directory already exists: $dir"
	fi
done

# Detect the operating system
echo "Running OS-specific setup"
if [[ "$OSTYPE" == "darwin"* ]]; then
	# macOS
	echo "macOS detected, running macOS setup script..."
	if [ -f "./macos/setup.sh" ]; then
		zsh ./macos/setup.sh
	else
		echo "Error: macOS setup script not found at ./macos/setup.sh"
		exit 1
	fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
	# Linux
	echo "Linux detected, running Linux setup script..."
	if [ -f "./linux/setup.sh" ]; then
		zsh ./linux/setup.sh
	else
		echo "Error: Linux setup script not found at ./linux/setup.sh"
		exit 1
	fi
else
	echo "Unsupported operating system: $OSTYPE"
	exit 1
fi

# Set up Stow
zsh ./safe-stow.sh
