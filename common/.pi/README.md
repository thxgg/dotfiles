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

The workspace targets Pi `1.4.0`. Vite+ owns the CLI installation.
Keep workspace pins aligned with the CLI when validating upgrades;
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

Pi Voice is declared at `^0.2.0` for `@earendil-works/pi-voice`. Change the dependency in
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

## Centered TUI layout

`agent/extensions/pi-centered.ts` loads our local adaptation of `pi-centered`
0.1.0 from `agent/lib/pi-centered/`. Do not also install the upstream npm package.
It centers the transcript, editor, and footer with a default maximum width of
110 cells. Rendered Mermaid diagrams ignore that limit and center within the
terminal. Diagrams too wide for the terminal stay as source in the text column.
After deployment, run `/reload` or restart Pi. Use `/maxwidth 100` to change the
width, `/maxwidth` to inspect it, and `/maxwidth off` to restore native full width.

The layout stays centered during runtime replacement. Thin wrappers around Pi's
reload/new/resume/fork/import operations release the old layout when replacement
finishes without centering, including removal or load failure. Quit still cleans up
immediately. The first reload from an older version can still use its old teardown.

The package saves the width in machine-local `~/.pi/agent/pi-centered.json`.
Keep that file outside Stow. `PI_CENTERED_WIDTH=90 pi` overrides the width for
one launch. The extension patches TUI rendering internals, so check resizing,
selection, and existing UI extensions after Pi upgrades. See the
[local changes and tests](agent/lib/pi-centered/README.md).

## Native MCP and extension controls

Pi uses its built-in MCP support. Put project servers in `.pi/mcp.json` after
reviewing and trusting the project. The former MCP adapter and Pi Ephemeral are retired.
To migrate their old project configs, run `node scripts/migrate-pi-mcp.mjs <project-root>...`.
The script merges servers without overwriting native entries, archives Ephemeral's
manifest and adapter config, and preserves other project resources, such as skills.
Shared `.mcp.json` files are copied, not removed. Unsupported adapter fields fail
validation instead of disappearing. Native MCP has no adapter-style idle disconnect.
Native OAuth uses its own credentials; re-authenticate remote servers with
`/mcp login <server>` when necessary.
Do not run `pi mcp list` merely to check config: it connects enabled servers.

`pi-extmgr` is pinned to `0.4.2` in `agent/npm/package.json` for `/extensions` package management.
`scripts/patch-pi-extmgr.mjs` defers command/UI imports while keeping synchronous
completions, startup hooks, and scheduled update settings intact. The package installer
and `dot update` apply it after installation/update. Source hashes reject unsupported
versions or local edits before mutation. Rebase the patch before changing the pin.
A direct `pi update --extensions` can overwrite the patch; reapply it from the repository:

```sh
node scripts/patch-pi-extmgr.mjs
```

This command changes only the installed `pi-extmgr` sources, not Pi or user settings.
Restart Pi or run `/reload` afterward. The existing local `/toggle-skills` extension
manages skill invocation separately.

## Native codemode

Enable native codemode alongside direct tools in machine-local `~/.pi/agent/settings.json`:

```json
{
  "defaultTools": ["+codemode"],
  "codemode": { "mode": "on" }
}
```

Merge these preferences with existing settings. Do not replace the file or stow it.
Use codemode for bounded tool batches and native MCP calls, and keep `Agent` and
`workflow` for isolated model work. SDK child sessions still opt out of parent extensions.

Nested calls pass through the Git guard and cloak hook. Verbosity uses native renderer
hooks without replacing executable tools. It groups direct tool rows and summarizes each
codemode script from its nested-call details. Expansion shows the native script and output;
nested execution events never create separate rows.
The aggregate check runs an offline SDK test with a scripted provider, real codemode,
local tools, and these hooks. It does not contact providers or start MCP servers.

Anthropic prompt sanitation uses `context_with_system` and a final `before_provider_request`
check. The final check covers full prompt overrides, such as T3's orchestration instructions,
which Pi can project after the context hook. It removes the Pi documentation from request-local
system content and section updates, preserving tool declarations, non-system messages,
cache metadata on retained blocks, and saved session history. The codemode tool's own documentation
path remains available. Codemode scripts must test tool presence with `"name" in tools`;
Pi 1.0 throws when a script reads an unknown member, including through `typeof`.

Pi 1.0 compatibility checks also cover grammar-call history replay through our OpenAI
alias wrapper after switching from Anthropic or a gateway. Keep the WebSocket wrapper,
Painter's ChatGPT-backed image path, child-session extension isolation, and static themes:
Pi 1.4.0 does not replace these behaviors. Native image generation is an additional provider
path. Codemode `image()` now saves images to user-private temporary files and returns their
paths; this does not replace Painter's persistent artifact storage or subscription-backed image path.

## OpenAI chat models and speed aliases

Chat models use the `openai` provider with **Sign in with ChatGPT** OAuth.
Pi 0.99.2 supersedes the legacy `openai-codex` chat connection with this provider.
Use `/login openai` and choose the ChatGPT subscription login, not an API key.
The subscription route uses `https://api.openai.com/v1`; this endpoint does not
by itself imply API-key billing. If you replace OAuth with an API key, requests
use separate API billing instead.

`agent/models.json` provides `openai/gpt-6-astra-fast`,
`openai/gpt-6.1-sol-fast`, and `openai/gpt-6-astra-ultrafast`.
The existing `gpt6-sol-aliases.ts` extension rewrites their upstream model IDs
and sends `service_tier: "priority"` for Fast or `"ultrafast"` for Ultrafast.
It is the single `openai-responses` provider wrapper, including direct compaction
requests. Its dedicated `agent/lib/openai-websocket.ts` module adds WebSocket
transport and routing hints to aliases and ordinary OpenAI chat models. Do not
load a second provider wrapper.

Keep Astra Fast as the default. Migrate machine-local `defaultProvider`,
`enabledModels`, `modelThinkingLevels`, and `compaction.modelOverrides` from
`openai-codex` to `openai` where present. Keep model IDs and thinking levels,
except retired `gpt-6-sol` selections, which should use `gpt-6.1-sol`.
These settings remain untracked. New defaults do not change models recorded in
old sessions. After `/reload`, select the migrated model explicitly:

```text
/model openai/gpt-6-astra-fast
```

Prompt-driven subagents inherit the parent's model. Workflow defaults and recap use `openai`.
The direct `generate_image` tool still uses the legacy `openai-codex` credential
and backend image endpoint. The former Painter subagent and other named profiles are removed.
See [the headless subagent fork](agent/extensions/subagents/README.md) for CLI controls,
plain-process execution, and saved-session behavior.
Do not remove that credential or migrate the image client. If it reports an
invalidated token, run `/login openai-codex` in Pi. The new subscription API
does not currently support image generation.

### OpenAI WebSocket transport

The OpenAI extension prefers reusable WebSockets on `wss://api.openai.com/v1/responses`.
It only wraps provider `openai`, API `openai-responses`, and the public OpenAI base URL.
Other providers, custom endpoints, and Painter's legacy image client are unchanged.
Authentication still comes from Pi; the extension does not read, refresh, or save credentials.
No global transport setting is required. With the existing Stow leaf link, run
`/reload` in the Pi session to activate the change; new sessions load it automatically.
The entry resolves its source path before importing the transport, so it also works
before the new library file has a separate home link. For a fresh deployment, use
`./safe-stow.sh --only-pi` from the repository root.

Each handshake carries `x-codex-routing-hint` derived from the final serialized request:

- Astra Fast: `model=gpt-6-astra;tier=priority`
- Astra Ultrafast: `model=gpt-6-astra;tier=ultrafast`
- Sol Fast: `model=gpt-6.1-sol;tier=priority`
- Ordinary models without a requested tier: `model=<upstream-model>`

The hint is advisory. A successful request or returned `default` tier does not
prove the processing tier granted by the backend.

The transport preserves Pi's serializer, full context, tools, images, reasoning,
usage accounting, and provider-event hooks. It does not introduce prefill,
`previous_response_id` chaining, prompt filtering, or benchmark limits on output.
The HTTP-compatible response hook includes `x-pi-transport: websocket` for a socket
request; its synthetic HTTP 200 represents the event-stream bridge, not an HTTP generation.

Sockets are reused only within a session with identical handshake headers. A
credential refresh, account change, model/tier change, or changed header opens a
new socket. Concurrent requests do not share a socket. Idle sockets close after
two minutes and rotate after 45 minutes. Session replacement, reload, and shutdown
cancel active work and close sockets. The cache retains at most 16 idle/session entries.

The existing transport preference is honored:

- `auto` or unset: try WebSocket, then SSE only if the handshake fails before sending.
- `websocket` or `websocket-cached`: require WebSocket; still send full context.
- `sse`: use HTTP/SSE with the routing hint. This is the rollback option, but Pi's
  setting itself is global and can also affect other providers that honor it.

There is **no transport replay after `response.create` is sent**, even if no visible
text has arrived. Pi's separate agent-level retry policy remains unchanged.
Caller-supplied fetch adapters and provider-scoped proxy environments retain HTTP
handling. The normal WebSocket adapter uses Pi's own Undici dependency and global
dispatcher, including Pi's configured proxy/TLS policy. No dependency is added.

`websocketConnectTimeoutMs` bounds the handshake (default 15 seconds, 0 disables it).
`timeoutMs` bounds stream idleness (default five minutes, 0 disables it). A separate
fixed ten-minute request deadline prevents periodic events from holding a request
open forever. Undrained event buffers are limited to 16 MiB.

Offline loopback tests cover transport behavior and use synthetic credentials.
On 1 October 2026, Pi 0.99.2 live checks passed for Astra, Astra Fast, Astra Ultrafast,
Sol, Sol Fast, and an Ultrafast `read` round trip. A small preceding benchmark favored
reused WebSockets; header benefits were inconclusive. These checks do not validate
all long-running TUI lifecycle or backend failure behavior.

Related upstream work (status checked 1 October 2026):

- [#3442](https://github.com/earendil-works/pi/issues/3442): general Responses WebSocket support, closed.
- [#1630](https://github.com/earendil-works/pi/pull/1630): implementation proposal, closed without merge.
- [#7648](https://github.com/earendil-works/pi/pull/7648): legacy Codex WebSocket retry handling, open.
- [#6513](https://github.com/earendil-works/pi/issues/6513): cached Codex socket account changes, open.
- [#9474](https://github.com/earendil-works/pi/issues/9474): non-resetting Codex request deadlines, open.
- [#9481](https://github.com/earendil-works/pi/issues/9481): canonical Codex turn attribution, open.

This extension is a local transport workaround, not full Codex parity. It does not
copy legacy Codex authentication, attribution metadata, or backend-specific headers.

### Optional Astra Ultrafast

Keep Ultrafast out of automatic cycling until its served tier is verified.
Select it explicitly:

```text
/model openai/gpt-6-astra-ultrafast
```

Or start a separate session:

```sh
pi --provider openai --model gpt-6-astra-ultrafast
```

Ultrafast requires an eligible account. On 1 October 2026, the account catalog
advertised Astra Ultrafast. A small OpenAI OAuth request with
`service_tier: "ultrafast"` completed with HTTP 200 and `ULTRAFAST_OK`, but
the returned tier was `default`. This verifies subscription connectivity, not
Ultrafast processing or speed. The legacy Codex request returned HTTP 401.
Resuming an Ultrafast session restores that selection, and compaction also
requests Ultrafast.

OpenAI lists Ultrafast at 8× Standard included usage and 6× purchased-credit usage.
Pi 1.0.0 has no native Ultrafast cost multiplier, so the alias carries 6× token
rates for a credit-priced estimate. Fast uses standard token rates plus Pi's
service-tier multiplier. These estimates are not the subscription allowance
balance and do not detect server fallback.

Third-party credit use requires a separate opt-in in ChatGPT Settings → Usage
and an app limit of 100%. This migration does not enable credit use or automatic
credit purchases. See [app usage and credits](https://help.openai.com/articles/20001542),
[subscription API limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
and [Codex speed and billing](https://developers.openai.com/codex/speed).

## Subscription usage and banked resets

The local `agent/extensions/usage/` workspace adds the standalone `/usage`
command. Its menu lists OpenAI and Anthropic quota summaries, plus Close.
Select a provider for details and reset inventory. It uses native Pi selectors and an account-specific
confirmation before spending a reset credit. It reads metadata only, never
sends generation probes, and leaves Pi's model retry policy unchanged.

Codex quotas use the separate legacy `openai-codex` OAuth credential. They are
**not** the allowance for current `openai` token-sharing chat models. Claude
uses Pi's `anthropic` OAuth login and its profile organization. API-key billing
is not supported by this subscription dashboard.

The extension keeps last-good bars, uses actual durations, supports dynamic
Claude model windows and overage indicators, and shares polling/backoff and
reset idempotency state across Pi processes. Runtime state stays outside Stow
at `~/.local/state/pi-subscription-usage/`. Do not delete unconfirmed reset state.
See [provider limits, safeguards, and activation](agent/extensions/usage/README.md).
Live provider compatibility and real reset redemption are not yet verified.

## Background compaction

`agent/extensions/zz-background-compaction.ts` prepares a summary at 85% of Pi's
compaction threshold, then supplies it when threshold compaction is due. The
foreground session keeps its full context until that point. `/bg-compact`
shows status; `/bg-compact off` disables preparation for the session.

It keeps follow-up messages unchanged and falls back to native compaction when
needed. Manual compaction and overflow recovery remain native. OpenAI Responses
summaries preserve the actual foreground request prefix and cache key for cache
reuse. Load this extension after payload transformers; other providers keep Pi's
serialized summary path. Discarded requests can still cost tokens.
See [operation, cost limits, research, and tests](background-compaction.md).

## Workflow startup recovery

Workflow orphan recovery runs in the background. It reads one state file at a time
and yields between files instead of parsing the whole history in `session_start`.
Shutdown cancels and joins the scan before retiring the extension context. Recovery
still marks dead-owner runs as failed/incomplete and preserves partial results.
Changed snapshots are skipped; recovery errors leave files intact and show a warning.
There is no new history format, index, or migration.

## Session recap

Recap starts off in every new, resumed, forked, or reloaded session. Type `/recap`
to enable it for the current session and generate a recap. Type `/recap` again to
turn it off and stop pending work and focus monitoring. The toggle is not saved.
Legacy `recap.enabled` settings and cached global toggle state are ignored.

While enabled, recap keeps its automatic focus-based refresh behavior unless
`recap.auto` is false. `/recap on`, `/recap off`, `/recap refresh`, and `/recap clear`
remain available. Tree navigation and compaction do not change the toggle.

## T3 Code visual guide

`agent/extensions/t3-visual-guide.ts` adds `agent/t3/visual-guide.md` to the system prompt
only when T3 Code hosts Pi. T3 sets `T3_MCP_URL` for Pi sessions that receive its tools,
including `html_render`. The TUI does not set it, so the extension registers no handler there.
In T3, the guide is a separate `t3_visual_guide` prompt section next to T3's own instructions.
The extension reads the guide on each run, so edits apply without `/reload`.
Deploy both files with `./safe-stow.sh --only-pi`.

Claude Code in T3 can read the same file. In T3, open Settings > Providers > Claude and set
the launch arguments to an absolute path; T3 does not expand `~`:

```text
--append-system-prompt-file /home/<user>/.pi/agent/t3/visual-guide.md
```

T3 provider settings are machine-local, so set this on each machine. Codex in T3 has no
file-based equivalent and does not receive the guide.

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
Its discovery code includes the canonical-file deduplication fix from
[`dmmulroy/.dotfiles@6f3b347`](https://github.com/dmmulroy/.dotfiles/commit/6f3b3470b1af6e49f381682f701bc675ef3bee46).
Keep the local symlink-preserving atomic writes and failed-write cleanup when syncing upstream.

Runtime state, credentials, sessions, and machine-local provider overlays must remain untracked.
