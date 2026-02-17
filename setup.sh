#!/usr/bin/env zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
CREATE_USER_DIRS=1

usage() {
	cat <<'EOF'
Usage: ./setup.sh [options]

Options:
  --skip-user-dirs  Skip creating personal directory scaffold
  --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--skip-user-dirs)
			CREATE_USER_DIRS=0
			shift
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

	echo "Creating user directories..."
	for dir in "${USER_DIRS[@]}"; do
		if [[ ! -d "$dir" ]]; then
			echo "Creating directory: $dir"
			mkdir -p "$dir"
		else
			echo "Directory already exists: $dir"
		fi
	done
fi

echo "Running OS-specific setup"
if [[ "$OSTYPE" == "darwin"* ]]; then
	echo "macOS detected, running macOS setup script..."
	zsh "$SCRIPT_DIR/macos/setup.sh"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
	echo "Linux detected, running Linux setup script..."
	zsh "$SCRIPT_DIR/linux/setup.sh"
else
	echo "Unsupported operating system: $OSTYPE"
	exit 1
fi

zsh "$SCRIPT_DIR/safe-stow.sh"
