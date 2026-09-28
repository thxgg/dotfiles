# Pi extension workspace

This directory is the npm workspace for package-style global Pi extensions under `agent/extensions/`.
Pi auto-discovers those extensions after `common/` is stowed into `$HOME`.
Use `./safe-stow.sh --only-pi` from the repository root to deploy only Pi files.
This mode backs up conflicts and does not migrate runtime state or touch other dotfiles.

## Install exact dependencies

```bash
cd common/.pi
vp install --frozen-lockfile
```

Vite+ honors the pinned npm version in `package.json`. `setup.sh` and `dot update` run this automatically.

The workspace targets Pi `0.87.1`. Pi now declares its own `@earendil-works/pi-server` dependency; the workspace no longer pins that transitive dependency directly.

## External packages and Pi Voice

`agent/npm/package.json` is the single external package declaration. Its standard `dependencies`
map declares npm packages. Its repository-specific `piPackages` array declares pinned HTTPS Git
sources when needed. This custom field is consumed by our setup helper, not by npm or Pi.

`setup.sh` and `dot update` register these sources with `pi install`. Registration is necessary:
installing npm dependencies alone does not make Pi discover their resources. The helper preserves
unrelated packages and user preferences in machine-local `~/.pi/agent/settings.json`. Pi may update
the npm dependency map during package operations; review those changes before committing.

To restore declared packages without running the full bootstrap, run from the repository root:

```bash
zsh scripts/install-pi-packages.zsh
```

Pi Voice is pinned to `@earendil-works/pi-voice@0.1.0`. Change the dependency in
`agent/npm/package.json` to update it. The helper installs the replacement before removing
legacy Pi Transcribe Git registrations. Pi Voice migrates `pi-transcribe.json` to
`pi-voice.json` on first use. Model files remain in the local cache.

### First model setup on each machine

Run `/voice-settings` in interactive Pi (`/transcribe` remains an alias). Select and confirm the model download. Use these preferences:

| Setting | Preferred value |
| --- | --- |
| Model | `parakeet-unified-en-0.6b` |
| Preferred language | English (`en`) |
| Transcription language | English (`en`) |
| Shortcut | `ctrl+alt+z` |
| Microphone | System default |

These are documented defaults, not an automatically applied settings file. Model downloads remain
explicit. On macOS, allow microphone access for the terminal app when prompted.

FFmpeg is declared in both OS package manifests. It is required for `transcribe_file`, but not for
microphone dictation. If it is outside `PATH`, set `PI_VOICE_FFMPEG_PATH` locally. The legacy `PI_TRANSCRIBE_FFMPEG_PATH` is also supported.

Keep `~/.pi/agent/pi-voice.json` machine-local. It contains an absolute model path, and the
extension replaces it when saving settings. Do not symlink it into the repository. Downloaded
models remain in the local Hugging Face cache. `doctor.sh` checks package registration, the pinned
npm version, FFmpeg availability, and the configured model file. These checks do not record audio,
load a model, or download files.

## MCP adapter fork

The vendored adapter targets upstream 3.1.0. Keep the local shared-project-config opt-out
and strict OAuth environment interpolation patches when updating it. Adapter-owned files
are now `~/.pi/agent/mcp-adapter.json` and `.pi/mcp-adapter.json`; shared `.mcp.json`
files keep their names. `pi-ephemeral` writes the adapter-owned project file. Rename old
adapter `mcp.json` files only after checking that no destination exists. Do not move files
owned by Pi's built-in MCP support. Project servers now require trust and approval.

## Validate extensions

```bash
npm --prefix common/.pi run check
```

The aggregate check type-checks standalone extensions, `pi-cloak`, and extension workspaces.
It also runs isolated standalone import/registration checks, masking and prompt-sanitation tests,
and each workspace's available tests. Herdr-managed source retains its upstream `@ts-nocheck`;
its import and inactive-outside-Herdr behavior are checked without editing that integration.
After changing extension code, reload Pi with `/reload`.

Use `/toggle-skills` in interactive Pi sessions to switch discovered skills between agent-invocable and manual-only modes. The command updates each skill's `disable-model-invocation` frontmatter and reloads Pi resources.

Runtime state, credentials, sessions, and machine-local provider overlays must remain untracked.
