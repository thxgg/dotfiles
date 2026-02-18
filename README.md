# Dotfiles

This repository manages shell/editor/system configuration with GNU Stow.

Stow payload is split into shared + OS-specific roots:

- `common/` for cross-platform dotfiles
- `macos/home/` for macOS-only dotfiles
- `linux/home/` for Linux-only dotfiles

## Quick Start

1. Clone this repository.
2. Run `./setup.sh`.
3. The setup script runs OS-specific package setup, then runs safe stow.

Useful setup flags:

- `--skip-user-dirs`
- `--skip-network-check`

If you only want stow linking without package installation, run `./safe-stow.sh`.

Validate key symlinks and stow setup health:

- `./doctor.sh`

## Git Hooks

This repo includes a `gitleaks` pre-commit hook at `.githooks/pre-commit`.

Enable it once per clone:

- `git config core.hooksPath .githooks`

Optional bypass for emergency local commits:

- `SKIP_GITLEAKS=1 git commit ...`

## Repository Structure

- `common/`: shared dotfiles and app configs
- `macos/`: Homebrew setup (`Brewfile`, `setup.sh`)
- `macos/home/`: macOS-only stow payload mirrored to `$HOME`
- `linux/`: Arch Linux setup (`yay` package profiles, `setup.sh`)
- `linux/home/`: Linux-only stow payload mirrored to `$HOME`
- `setup.sh`: top-level setup entrypoint
- `safe-stow.sh`: conflict-aware stow with automatic backups
- `unstow.sh`: remove stow links for active roots on current OS
- `doctor.sh`: verifies key managed paths are symlinked correctly

## macOS Setup

- Package management is declarative via `macos/Brewfile`.
- `macos/setup.sh` runs:
  - Homebrew install if missing
  - `brew update` and `brew upgrade`
  - `brew bundle --file=./macos/Brewfile`
  - service setup for PostgreSQL and Redis

Useful commands:

- `brew bundle check --file=./macos/Brewfile`
- `brew bundle --file=./macos/Brewfile`

## Linux Setup (Arch + yay)

Linux setup is Arch-only and requires `yay`.

Package profiles are in `linux/packages/`:

- `core-cli.txt`
- `core-apps.txt`
- `desktop-hyprland.txt`
- `virtualization.txt`

Default profiles installed:

- `core-cli`
- `core-apps`
- `desktop-hyprland`

Optional flags:

- `--dry-run`
- `--with-virtualization`
- `--profiles core-cli,core-apps`

## Stow Workflow

- `./safe-stow.sh` resolves active stow roots by OS (`common` + `macos/home` on macOS, `common` + `linux/home` on Linux)
- it checks for conflicts in `$HOME`
- existing non-symlink files are backed up to `~/.dotfiles_backup_<timestamp>/`
- `~/.ssh` stays a real directory so local keys are preserved
- `~/.config` stays a real directory and each direct child is symlinked from the active roots
- only leaf entries like `~/.ssh/config` are symlinked from active roots
- duplicate target paths across roots are rejected before deploy
- stow then links all active roots into `$HOME`

To remove links:

- `./unstow.sh`

## Tracked vs Untracked

Tracked in this repo:

- shell config (`.zshrc`, `.zprofile`, `.zshenv`)
- git config
- neovim config
- selected app configs under `.config/`

## Secret Hygiene Before Public Repo

Before making this repository public, remove or refactor all hardcoded secrets to env vars or local untracked files.

Recommended pattern:

- keep machine-specific secrets in local files sourced from `.zshrc`
- use env placeholders in tracked config
- re-scan with `rg -n "(api[_-]?key|token|secret|password|github_pat_|sk-)" common`

## Third-Party Sounds

The MP3 files in `common/.config/opencode/sounds/` are third-party assets and are not owned by this repository author.

These files are not covered by this repository's MIT license. All rights remain with their respective owners.

## Nerd Font Helper

Due to font licensing, fetch source font files manually, then use `patch-nerdfont.sh`.
