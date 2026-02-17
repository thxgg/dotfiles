# Linux Bootstrap

## Purpose & Scope
Arch-only machine bootstrap using `yay` with profile-based package manifests.
This area owns Linux package selection and post-install service/runtime setup.

## Entry Points & Contracts
- Entrypoint: `linux/setup.sh`.
- Supported platform contract: requires `/etc/arch-release` and `yay` in PATH.
- Package source of truth: `linux/packages/*.txt`.
- Default profiles: `core-cli`, `core-apps`, `desktop-hyprland`.

## Usage Patterns
- Add CLI/dev packages in `packages/core-cli.txt`.
- Add GUI apps in `packages/core-apps.txt`.
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
- Downlinks: none

## Patterns & Pitfalls
- Service enablement is best-effort and unit-name dependent (`postgresql18` and `postgresql` checks both exist).
- Keep profile files comment-friendly and one package per line for easy diff/review.
