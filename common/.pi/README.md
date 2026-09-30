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

The workspace targets Pi `0.99.1`, including the vendored MCP adapter's development dependencies.
Vite+ owns the CLI installation. Keep workspace pins aligned with the CLI when validating upgrades;
a successful check against older workspace dependencies does not validate a newer CLI.

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

## Native codemode

Enable native codemode alongside direct tools in machine-local `~/.pi/agent/settings.json`:

```json
{
  "defaultTools": ["+codemode"],
  "codemode": { "mode": "on" }
}
```

Merge these preferences with existing settings. Do not replace the file or stow it.
Use codemode for bounded tool batches and filtering. Keep `mcpScript` for the adapter's
MCP calls, and keep `Agent` and `workflow` for isolated model work. Native codemode does
not require native MCP servers. SDK child sessions still opt out of parent extensions.

Nested calls pass through the Git guard and cloak hook. Verbosity grouping ignores nested
execution events because codemode owns their display; direct tool rows remain grouped.
The aggregate check runs an offline SDK test with a scripted provider, real codemode,
local tools, and these hooks. It does not contact providers or start MCP servers.

Anthropic prompt sanitation uses `context_with_system`. It removes the Pi documentation
from request-local system content and section updates, preserving tool declarations,
non-system messages, and saved session history.

## Optional Astra Ultrafast (paid API)

`agent/models.json` adds `openai/gpt-6-astra-ultrafast`, labeled
**GPT-6 Astra Ultrafast (PAID API)**. It uses the existing OpenAI API-key credential,
not the Codex subscription. Native `samplingParams` sends `model: "gpt-6-astra"`
and `service_tier: "ultrafast"`; no additional provider wrapper is needed.
Standard Astra and the existing Codex Fast aliases remain unchanged.

Keep this model out of machine-local `enabledModels` so `Ctrl+P` does not cycle
into paid Ultrafast. Keep `openai-codex/gpt-6-astra-fast` as the saved default.
To opt in for a separate session:

```sh
pi --provider openai --model gpt-6-astra-ultrafast
```

Or select `/model openai/gpt-6-astra-ultrafast` manually. Do not press `Ctrl+S`
unless you intend to make it the default. Resuming an Ultrafast session restores
that selection. Compaction in that session also uses Ultrafast.

The alias includes published Ultrafast prices because Pi 0.99.1 has no Ultrafast
cost multiplier: $60 input, $6 cached input, and $300 output per million tokens
at short context. See [OpenAI pricing](https://developers.openai.com/api/docs/pricing).
Displayed costs remain estimates, particularly if the server falls back to another
tier. The prior API-key probe returned `ultrafast`; the subscription probe returned
`default`. Changing the OpenAI credential to ChatGPT OAuth does not guarantee
Ultrafast access.

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
