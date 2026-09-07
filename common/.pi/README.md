# Pi extension workspace

This directory is the npm workspace for package-style global Pi extensions under `agent/extensions/`.
Pi auto-discovers those extensions after `common/` is stowed into `$HOME`.

## Install exact dependencies

```bash
cd common/.pi
vp install --frozen-lockfile
```

Vite+ honors the pinned npm version in `package.json`. `setup.sh` and `dot update` run this automatically.

Pi `0.85.0` imports `@earendil-works/pi-server` through its SDK but does not declare that dependency. This workspace pins it explicitly so SDK imports and extension tests work. Remove this workaround when Pi declares the dependency or no longer imports it.

## External packages and Pi Transcribe

`scripts/pi-packages.txt` declares external packages separately from the local npm workspace.
`setup.sh` and `dot update` install these packages with Pi's package manager. The helper preserves
unrelated packages and user preferences in the machine-local `~/.pi/agent/settings.json`.

To restore declared packages without running the full bootstrap, run from the repository root:

```bash
zsh scripts/install-pi-packages.zsh
```

Pi Transcribe uses a public HTTPS source pinned to a tested commit. To update it, change the ref
in `scripts/pi-packages.txt`, then run the helper. `pi update --extensions` keeps that pin.
Pi manages the checkout and dependencies under `~/.pi/agent/git/`; do not edit or Stow that directory.
Pi can reset and clean this checkout when it changes the pinned ref.

### First model setup on each machine

Run `/transcribe` in interactive Pi. Select and confirm the model download. Use these preferences:

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
microphone dictation. If it is outside `PATH`, set `PI_TRANSCRIBE_FFMPEG_PATH` locally.

Keep `~/.pi/agent/pi-transcribe.json` machine-local. It contains an absolute model path, and the
extension replaces it when saving settings. Do not symlink it into the repository. Downloaded
models remain in the local Hugging Face cache. `doctor.sh` checks package registration, the pinned
checkout, FFmpeg availability, and the configured model file. These checks do not record audio,
load a model, or download files.

## Validate extensions

```bash
npm --prefix common/.pi run check
```

The aggregate check type-checks the covered extension workspaces and runs their available tests.
After changing extension code, reload Pi with `/reload`.

Use `/toggle-skills` in interactive Pi sessions to switch discovered skills between agent-invocable and manual-only modes. The command updates each skill's `disable-model-invocation` frontmatter and reloads Pi resources.

Runtime state, credentials, sessions, and machine-local provider overlays must remain untracked.
