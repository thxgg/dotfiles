# Common Home Tree

Shared configuration for macOS and Linux. Root placement, deployment, secret, and theme contracts apply here.

## Configuration Contracts
- `~/.config` remains a real directory. Deployment links each direct child from the active roots.
- Give each application's configuration its own `.config/<tool>/` directory. Shared files must work on both platforms; guarded platform-specific behavior is allowed.
- Keep configuration minimal and reproducible. Exclude runtime caches, generated dependency trees, machine-only binaries, and generated blobs unless tracking them is intentional. Update `.gitignore` for generated output.
- Empty directories are not meaningful stow artifacts; manage concrete files or symlinks.
- Codex `config.toml` and MCP authentication remain machine-local. Keep personal instructions in `.codex/AGENTS.md` and shared skills in `.agents/skills/`.

## Validation and Deployment
Test new or changed configuration before deployment. Use the relevant checks in `tests/README.md`; editing a file does not require deploying it.

When config deployment is requested, use the smallest applicable scope. Run from the repository root:

```sh
./safe-stow.sh --only-config nvim   # Deploy one configuration
./doctor.sh --only-config nvim     # Check its deployed paths without Pi checks
```

## Navigation
- [Root](../AGENTS.md)
- [Neovim Config](./.config/nvim/AGENTS.md)
- [Codex Instructions](./.codex/AGENTS.md)
- [Pi Global Prompt Notes](./.pi/agent/AGENTS.md)
- OpenCode MCP/UI configuration and Herdr integration: `.config/opencode/`
