# Dotfiles

Personal machine bootstrap and dotfiles repository using GNU Stow.

Current configuration and architecture sections describe the implementation, not permanent requirements. Update these facts when an authorized change modifies them.

## Where to Look
| Task | Location | Notes |
|------|----------|-------|
| Bootstrap a machine | `setup.sh` | Runs OS setup, then deployment |
| Deploy or remove links | `safe-stow.sh`, `unstow.sh` | Conflict backups and scoped config selection |
| Check deployment | `doctor.sh` | Reports OK/WARN/FAIL; config-only checks exclude Pi health |
| Test changes | `tests/README.md` | Portable mocks and isolated Linux desktop checks |
| Manage external Pi packages | `common/.pi/agent/npm/package.json` | Single external package declaration; Vite+ owns CLI updates |
| Add macOS packages | `macos/Brewfile` | Homebrew formulae and casks |
| Add Arch packages | `linux/packages/*.txt` | Profile lists consumed by `linux/setup.sh` |
| Change shell or terminal behavior | `common/.config/fish/`, `common/.config/ghostty/`, `common/.config/herdr/` | Fish is the primary interactive shell |
| Change Neovim | `common/.config/nvim/` | Lazy plugin specs and core/user modules |
| Change agent instructions or skills | `common/.codex/AGENTS.md`, `common/.pi/agent/APPEND_SYSTEM.md`, `common/.agents/skills/` | Codex settings and MCP authentication remain machine-local |
| Change OpenCode | `common/.config/opencode/` | MCP/UI configuration and Herdr integration |

## Repository Contracts
- Paths in `common/`, `macos/home/`, and `linux/home/` map to `$HOME`. Put shared files in `common/` and platform-only files in the matching platform root. Guard platform-specific behavior inside shared files.
- Do not define the same target path in more than one stow root. Edit repository files, not separate live copies in `$HOME`.
- Declare package choices in `macos/Brewfile` or `linux/packages/*.txt`, rather than per-package install loops.
- Use `safe-stow.sh` instead of raw `stow` so conflicts are backed up. Editing and testing do not imply deployment authorization.
- Reject empty or invalid config selections before mutations. List-only mode is read-only. Scoped operations must not change unrelated home files or migrate Pi state.
- Test deployment and removal with temporary homes and mock commands. Portable tests must not execute inherited shell startup files or live clipboard/service tools.
- Keep secrets in untracked `~/.env.secrets`; tracked configuration may reference them. Do not commit credentials or token-bearing auth files.
- Keep hooks enabled with `git config core.hooksPath .githooks`. Fix gitleaks detections instead of bypassing them with `SKIP_GITLEAKS=1`.
- Keep static Catppuccin Latte/Mocha assets with Lavender accents. Do not restore repository-wide theme automation or controls that rewrite other applications' settings. Native per-application theme controls are allowed.
- Local Amp configuration is retired; Amp runs remotely through Orbs.

## Commands
Run from the repository root. Bootstrap and deployment change the machine; use them only when deployment is requested.

```sh
./setup.sh                              # Full bootstrap
./safe-stow.sh                          # Full deployment
./safe-stow.sh --only-config nvim        # Scoped deployment example
./doctor.sh                            # Full deployment health
./doctor.sh --only-config nvim          # Scoped health example
```

Platform validation commands are in the platform instructions. Test commands and their limits are in `tests/README.md`.

## Related Instructions
- [Common Home Tree](./common/AGENTS.md)
- [Linux Bootstrap](./linux/AGENTS.md)
- [macOS Bootstrap](./macos/AGENTS.md)
