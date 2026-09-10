# Linux Bootstrap

## Purpose & Scope
Arch-only machine bootstrap using `yay` with profile-based package manifests.
This area owns Linux package selection, post-install service/runtime setup, and Linux-only stow payload.

## Entry Points & Contracts
- Entrypoint: `linux/setup.sh`.
- Supported platform contract: requires `/etc/arch-release` and `yay` in PATH.
- Package source of truth: `linux/packages/*.txt`.
- Dotfile payload root: `linux/home/` (mirrors `$HOME` for Linux-only files).
- Default profiles: `core-cli`, `core-apps`, `desktop-hyprland`.

## Usage Patterns
- Add CLI/dev packages in `packages/core-cli.txt`.
- Add GUI apps in `packages/core-apps.txt`.
- Keep Linux-only dotfiles in `linux/home/` and out of `common/`.
- Keep optional stacks isolated (`desktop-hyprland.txt`, `virtualization.txt`).
- Validate without install:
```bash
zsh ./linux/setup.sh --dry-run
```

## Anti-Patterns
- Adding non-Arch package manager logic (repo policy is Arch + `yay` only).
- Duplicating package names across profiles without reason.
- Coupling Linux package changes to shared `common/` behavior unless truly needed.

## Dependencies & Edges
- Uplink: [Root](../AGENTS.md)
- Downlink: [Linux Home Payload](./home/AGENTS.md)

## Patterns & Pitfalls
- Service changes apply only to requested packages. Missing units are skipped; failures from existing units stop setup.
- Replace conflicting system Node.js providers in one package transaction. Never remove a provider first with dependency checks disabled.
- `--with-virtualization` adds to either the default or explicitly selected profiles.
- Keep profile files comment-friendly and one package per line for easy diff/review.
- Vite+ manages project Node.js selection. Bootstrap installs LTS and Node 14 for legacy admin deployment parity; the legacy admin's local `.node-version` selects 16.20.2.
- Themes use static application assets; no theme controller, shared theme-state reader, session-start hook, or wallpaper polling service is deployed.
- `--dry-run` requires Arch Linux and previews conditional post-install actions. On macOS, run `zsh -n linux/setup.sh` and the mocked tests in `tests/linux-bootstrap.test.py`.
- Recording clipboard and launcher fallback tests live in `tests/linux-recording.test.py` and `tests/linux-panel-launcher.test.py`. They do not validate real Wayland paste or desktop behavior.
