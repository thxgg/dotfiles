# Linux Bootstrap

Arch-only bootstrap using `yay` and package profiles. Entrypoint: `linux/setup.sh`; package manifests: `linux/packages/*.txt`.

## Current Configuration
- Default profiles are `core-cli`, `core-apps`, and `desktop-hyprland`.
- Vite+ manages project Node.js selection. Bootstrap installs LTS and attempts Node 14 installation for legacy deployment parity; a Node 14 failure does not stop setup. Project `.node-version` files control local selection.

## Bootstrap Contracts
- Require `/etc/arch-release` and `yay` in PATH. Do not add other distribution package managers.
- Put CLI/dev packages in `core-cli.txt` and GUI applications in `core-apps.txt`. Keep desktop and virtualization stacks in separate profiles.
- Keep profiles comment-friendly, with one package per line. Avoid duplicate package names without a reason.
- Apply service changes only to requested packages. Skip missing units; failures from existing units stop setup.
- Replace conflicting system Node.js providers in one package transaction. Do not remove a provider first with dependency checks disabled.
- `--with-virtualization` adds to either default or explicitly selected profiles.

## Validation
`zsh ./linux/setup.sh --dry-run` requires Arch Linux and previews conditional post-install actions.

On macOS, run from the repository root:

```sh
zsh -f -n linux/setup.sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-bootstrap.test.py
```

Recording and panel-launcher checks are documented in `tests/README.md`. Mocked tests do not validate real Wayland paste or desktop behavior.

## Navigation
- [Root](../AGENTS.md)
- [Linux Home Payload](./home/AGENTS.md)
