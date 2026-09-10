# macOS Bootstrap and Home Payload

Homebrew bootstrap with post-install runtime and service setup. Entrypoint: `macos/setup.sh`; package manifest: `macos/Brewfile`; payload: `macos/home/`.

## Current Configuration
- Install flow: ensure Homebrew, update/upgrade, run `brew bundle`, then configure services and tools.
- Current service formulae are `postgresql@18` and `redis`; the registered Homebrew JDK is version 21.
- Vite+ manages Node.js and global JavaScript packages. Bootstrap installs LTS and attempts Node 14 installation for legacy deployment parity; a Node 14 failure does not stop setup. Project `.node-version` files control local selection.
- Setup makes Fish the login shell when permitted and assigns text/code file types to VS Code when installed.

## Bootstrap Contracts
- Keep package choices in `Brewfile` and `setup.sh` focused on orchestration and post-install initialization.
- Load Homebrew shellenv before checking whether installation is needed. Support Apple Silicon and Intel paths.
- Keep service names aligned with the selected Homebrew formulae.
- Register the selected Homebrew JDK under `~/Library/Java/JavaVirtualMachines` so `/usr/libexec/java_home` and Fish can discover it.

## Home Payload Contracts
- Ghostty configuration and Catppuccin themes live in `Library/Application Support/com.mitchellh.ghostty/`. Preserve machine-specific paths in that configuration.
- `Library/LaunchAgents/com.thxgg.gui-path.plist` sets GUI PATH at login with user commands, Vite+, Homebrew, and system commands. Use a shell to expand `$HOME`; launchd does not expand it in plain arguments.
- Do not restore the removed artifact-cloud or theme synchronization LaunchAgents.

## Validation
Run from the repository root:

```sh
zsh -f -n macos/setup.sh
HOMEBREW_NO_AUTO_UPDATE=1 brew bundle check --file=./macos/Brewfile
plutil -lint macos/home/Library/LaunchAgents/com.thxgg.gui-path.plist
```

These checks do not install packages or deploy the payload.

## Navigation
- [Root](../AGENTS.md)
