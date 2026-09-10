# macOS Bootstrap

## Purpose & Scope
macOS bootstrap based on Homebrew plus post-install runtime initialization.
This area owns package manifests, mac-specific service/tool setup, and macOS-only stow payload.

## Entry Points & Contracts
- Entrypoint: `macos/setup.sh`.
- Package source of truth: `macos/Brewfile`.
- Dotfile payload root: `macos/home/` (mirrors `$HOME` for macOS-only files).
- Install flow: ensure Homebrew -> update/upgrade -> `brew bundle` -> service/tool setup.
- Current pinned database formula: `postgresql@18`.

## Usage Patterns
- Add/remove formulae/casks in `Brewfile` first.
- Keep macOS-only dotfiles in `macos/home/` and out of `common/`.
- Keep `setup.sh` focused on orchestration and post-install initialization.
- Validate state without installing new packages:
```bash
brew bundle check --file=./macos/Brewfile
```

## Anti-Patterns
- Reintroducing imperative per-package loops in `setup.sh`.
- Adding Linux-specific setup logic here.
- Hiding package decisions in script branches instead of `Brewfile` diffs.

## Dependencies & Edges
- Uplink: [Root](../AGENTS.md)
- Downlink: [macOS Home Payload](./home/AGENTS.md)

## Patterns & Pitfalls
- Service names are formula-specific (`postgresql@18`, `redis`).
- Load Homebrew shellenv before checking whether installation is needed; support Apple Silicon and Intel paths.
- Vite+ manages Node.js and global JavaScript packages. Bootstrap installs LTS and Node 14 for legacy admin deployment parity. Project `.node-version` files control local selection (the legacy admin currently pins 16.20.2).
- Register Homebrew JDK 21 under `~/Library/Java/JavaVirtualMachines` so `/usr/libexec/java_home` and Fish can discover it.
- Setup makes Fish the login shell when permitted and assigns text/code file types to VS Code when installed.
- The GUI PATH LaunchAgent includes user commands, Vite+, Homebrew, and system commands.
- Theme synchronization has no LaunchAgent. Keep manual theme commands and native application appearance settings.
