# Pi extension workspace

This directory is the npm workspace for package-style global Pi extensions under `agent/extensions/`.
Pi auto-discovers those extensions after `common/` is stowed into `$HOME`.

## Install exact dependencies

```bash
cd common/.pi
vp install --frozen-lockfile
```

Vite+ honors the pinned npm version in `package.json`. `setup.sh` and `dot update` run this automatically.

## Validate extensions

```bash
npm --prefix common/.pi run check
```

The aggregate check type-checks the covered extension workspaces and runs their available tests.
After changing extension code, reload Pi with `/reload`.

Use `/toggle-skills` in interactive Pi sessions to switch discovered skills between agent-invocable and manual-only modes. The command updates each skill's `disable-model-invocation` frontmatter and reloads Pi resources.

Runtime state, credentials, sessions, and machine-local provider overlays must remain untracked.
