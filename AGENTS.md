# DOTFILES KNOWLEDGE BASE

## Overview
Personal machine bootstrap + dotfiles repository using GNU Stow.
`common/` holds shared payload, while `macos/home/` and `linux/home/` hold OS-specific payload linked into `$HOME`.

## Structure
```text
dotfiles/
├── common/                     # shared stow payload mirrored to $HOME
│   ├── .config/                # app/tool configs
│   ├── .zshrc/.zprofile/...    # shell + git + ssh + psql
├── macos/                      # Homebrew bootstrap + Brewfile + macOS-only stow payload
│   └── home/                   # macOS-only stow payload mirrored to $HOME
├── linux/                      # Arch+yay bootstrap + package profiles + Linux-only stow payload
│   └── home/                   # Linux-only stow payload mirrored to $HOME
├── setup.sh                    # top-level orchestrator
├── safe-stow.sh                # conflict-aware stow deployment
├── unstow.sh                   # remove stow links
├── doctor.sh                   # symlink health checks
└── .githooks/pre-commit        # gitleaks staged-secret scan
```

## Where to Look
| Task | Location | Notes |
|------|----------|-------|
| Install on new machine | `setup.sh` | Runs OS setup then `safe-stow.sh` |
| Fix stow collisions | `safe-stow.sh` | Backs up conflicting leaf targets before linking active roots |
| Validate deployment | `doctor.sh` | Reports OK/WARN/FAIL on key managed paths |
| Add macOS packages | `macos/Brewfile` | Declarative source for brew formulae/casks |
| Add Arch packages | `linux/packages/*.txt` | Profile-based lists consumed by `linux/setup.sh` |
| Shell behavior | `common/.zshrc` + `common/.zsh/*` | Keep secrets in `~/.env.secrets`, not tracked files |
| Neovim behavior | `common/.config/nvim` | Lazy plugin specs + core/user modules |
| OpenCode setup | `common/.config/opencode` | Agents/commands/skills and local plugin code |

## Conventions (Project-Specific)
- Keep shared paths in `common/`; place OS-specific dotfiles in `macos/home/` or `linux/home/`.
- Do not define the same target path in more than one stow root.
- Prefer declarative package manifests (`macos/Brewfile`, `linux/packages/*.txt`) over ad-hoc install loops.
- Keep git hooks enabled with `git config core.hooksPath .githooks`.
- Use `safe-stow.sh` instead of raw `stow` so conflicts are backed up first.
- Keep machine secrets in untracked `~/.env.secrets`.

## Anti-Patterns (This Project)
- Committing secrets or token-bearing host files (for example auth host maps) without review.
- Editing files directly in `$HOME` and forgetting to sync back to `common/`, `macos/home/`, or `linux/home/`.
- Bypassing gitleaks by default (`SKIP_GITLEAKS=1`) instead of fixing detections.
- Adding OS-specific behavior into shared sections without guards.

## Commands
```bash
# Full machine bootstrap
./setup.sh

# Link dotfiles only
./safe-stow.sh

# Validate symlink health
./doctor.sh

# macOS package validation
brew bundle check --file=./macos/Brewfile

# Linux package dry run (Arch)
zsh ./linux/setup.sh --dry-run
```

## Intent Nodes
- [Common Home Tree](./common/AGENTS.md) - shared stowed files mirrored into `$HOME`
- [Linux Bootstrap](./linux/AGENTS.md) - Arch + `yay` package/profile orchestration
- [macOS Bootstrap](./macos/AGENTS.md) - Homebrew bootstrap and service setup
