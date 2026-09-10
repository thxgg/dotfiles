# DOTFILES KNOWLEDGE BASE

## Overview
Personal machine bootstrap + dotfiles repository using GNU Stow.
`common/` holds shared payload, while `macos/home/` and `linux/home/` hold OS-specific payload linked into `$HOME`.

## Structure
```text
dotfiles/
├── common/                     # shared stow payload mirrored to $HOME
│   ├── .config/                # app/tool configs (fish, nvim, ghostty, herdr, ...)
│   ├── .gitconfig/.ssh/...     # shared git, SSH, and database config
├── macos/                      # Homebrew bootstrap + Brewfile + macOS-only stow payload
│   └── home/                   # macOS-only stow payload mirrored to $HOME
├── linux/                      # Arch+yay bootstrap + package profiles + Linux-only stow payload
│   └── home/                   # Linux-only stow payload mirrored to $HOME
├── scripts/                    # package installers and shared shell helpers
├── tests/                      # portable regression and Linux desktop checks
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
| Validate deployment | `doctor.sh` | Reports OK/WARN/FAIL; config-only checks exclude Pi health |
| Test changes | `tests/README.md` | Portable mocks plus explicitly isolated Linux tray checks |
| Pi package manifests | `common/.pi/agent/npm/package.json` | External packages; Vite+ owns CLI updates |
| Add macOS packages | `macos/Brewfile` | Declarative source for brew formulae/casks |
| Add Arch packages | `linux/packages/*.txt` | Profile-based lists consumed by `linux/setup.sh` |
| Shell behavior | `common/.config/fish/config.fish` + `common/.config/herdr/config.toml` | Primary interactive shell is fish; keep secrets in `~/.env.secrets`, not tracked files |
| Neovim behavior | `common/.config/nvim` | Lazy plugin specs + core/user modules |
| Codex setup | `common/.codex` + `common/.agents/skills` | Tracked personal instructions and user-wide skills; Codex settings and MCP servers are machine-local |
| OpenCode setup | `common/.config/opencode` | MCP/UI configuration and Herdr integration |

## Conventions (Project-Specific)
- Keep shared paths in `common/`; place OS-specific dotfiles in `macos/home/` or `linux/home/`.
- Do not define the same target path in more than one stow root.
- Prefer declarative package manifests (`macos/Brewfile`, `linux/packages/*.txt`) over ad-hoc install loops.
- Keep git hooks enabled with `git config core.hooksPath .githooks`.
- Use `safe-stow.sh` instead of raw `stow` so conflicts are backed up first.
- Reject empty/invalid config selections before mutations. List-only mode must be read-only; scoped mode must not change unrelated home files or migrate Pi state.
- Test deployment and removal with temporary homes and mock commands. Do not let inherited shell startup files or live clipboard/service tools execute in portable tests.
- Keep static themes and native application appearance settings. Do not add theme-changing scripts, wrappers, shared theme state, or setup/update hooks.
- Keep machine secrets in untracked `~/.env.secrets`.
- Catppuccin Latte/Mocha assets use Lavender accents. Select themes in each application; there is no repository-wide theme controller.
- Local Amp configuration is retired; Amp runs remotely through Orbs.

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
