# Pi verbosity lab

```sh
./common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/check.sh
```

These offline checks use the installed Pi renderer and temporary agent state.
They do not execute fixture tools or make model requests. See
[`common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/README.md`](../common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/README.md)
for the CLI-only comparison viewer and its limits.

# Shared configuration checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/common-config.test.py
```

These checks use temporary homes. They check retired Amp/theme configuration,
Docker PATH guards, PostgreSQL history, and editor setup with stubbed LSP/DAP
interfaces. They check shared/macOS and Linux GTK/Kvantum/Hyprland/Rofi dark theme selections, isolated Fish colors,
and browser Mocha palette values. They do not verify application rendering or
installed GTK/Qt themes. They also verify that every shared skill has a relative Claude Code
symlink to the same source directory. Static checks reject retired launcher paths in both Hyprland configurations
and verify matching clipboard commands with an existing Wofi stylesheet.
They do not start language servers, install editor plugins, or verify live Linux
launcher and clipboard behavior.

# Root command and deployment safety checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/dot-safety.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/stow-safety.test.py
```

These checks use temporary homes and mock commands. They verify scoped deployment,
read-only listing, link ownership and backups, and root CLI behavior without changing
the live deployment.

# Handy launcher checks

```sh
shellcheck linux/home/.config/handy-launcher/launch
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-handy-launcher.test.py
```

Linux only. Requires `cc`, `desktop-file-validate`, and system Python with
PyGObject/Gio. Uses temporary homes, a mock Handy executable, and a C probe.
Checks the renderer shim, environment isolation, cache reuse, failure cleanup,
opt-out, desktop entry parsing, and matching Hyprland commands. It never starts
Handy or accesses the desktop/audio bus. Overlay rendering still needs a live
check; see `linux/home/.config/handy-launcher/README.md`.

# Linux offline checks

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-bootstrap.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-recording.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-panel-launcher.test.py
```

These tests use temporary files and mock commands. They do not change packages,
services, or the clipboard. Actual Wayland file paste, notifications, GTK/Qt
appearance, and HyprPanel startup still require a Linux desktop check.

The recording and panel launcher tests require Python 3, Bash, and standard Unix
commands. The panel launcher tests also require `awk`, `base64 --decode`, and Node.js.
Their shell subprocesses use a temporary `HOME` and a minimal environment. They
do not inherit `BASH_ENV`, exported shell functions, or desktop session variables.
The recording tests use a temporary recording state file and a mock action helper.
The panel tests check both fallback failures and the complete generated patch.
They also use a mock wallpaper daemon to check detached startup, pipe closure,
restart reuse, argument forwarding, startup failure, and missing runtime state.
These daemon checks require `flock` and `nohup`; they never contact Wayland.
They run the patched network helper in a mock reactive runtime. This checks late
device arrival, replacement, removal, empty icon names, connection switching,
and stale subscription cleanup. The same test must fail on the unpatched helper.
The suite also runs the injected WoW bar visibility controller with mock signals
and asynchronous compositor responses. It checks actual window visibility calls,
startup, empty/special workspace restoration, fullscreen versus maximized state,
game close/move, multiple monitors, manual visibility preferences, bar recreation,
query failures, stale results, and shutdown cleanup. The generated-runtime checks
require the upstream auto-hide initialization target exactly once.
It does not verify real Astal signal timing, GTK rendering, or Wayland input regions.

# Hyprland exclusive workspace checks

```sh
lua tests/linux-exclusive-workspace.test.lua
Hyprland --verify-config -c "$PWD/linux/home/.config/hypr/hyprland.lua"
```

The Lua suite mocks the compositor API. It checks launch placement, occupied
slots, both monitor ranges, source-workspace eviction, incoming apps, reloads,
close events, deferred and stale moves, multiple owners, and guarded controls.
It runs no shell or live desktop commands. The parser check requires Hyprland
0.56 with Lua support and does not launch a compositor. Real mouse press/release
routing and Wine window timing still require a desktop check. See
[`EXCLUSIVE-WORKSPACE.md`](../linux/home/.config/hypr/EXCLUSIVE-WORKSPACE.md).

# Linux locking checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-locking.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/linux-lock-diagnostics.test.py
```

These tests mock every process launch and use temporary paths. They check the
video/static selection, zero grace period, duplicate-lock handling, startup
fallback, lock-confirmed suspend, timeout cancellation, DPMS dispatch, activation
rollback, and both HyprPanel configurations. They do not lock, suspend, start idle
timers, or contact the desktop. A separate parser-only binary from
`build-hyprlock-video.sh` checks real Hyprlock config syntax without a Wayland or
authentication startup path. See
[`LOCKING.md`](../linux/home/.config/hypr/LOCKING.md) for staged activation and the
required later live tests. The diagnostic suite checks render-only patch targets,
no partial patch writes, a separate binary path, safe preflight, and log filtering.
It does not start a lock or measure actual GPU/rendering performance.

# Archon tray icon checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/archon-light-tray.test.py
```

Requires Python 3, PyGObject, and GdkPixbuf. Uses generated PNGs and mocked
AppImage extraction. Checks alpha preservation, cache reuse, version changes,
and incomplete-extraction cleanup. Does not launch Archon or use the desktop bus.

# HyprPanel tray checks

Run all three suites from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/hyprpanel-teams-unread.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/hyprpanel-teams-tray.py
dbus-run-session -- env TRAY_TEST_ISOLATED=1 PYTHONDONTWRITEBYTECODE=1 \
  GI_TYPELIB_PATH="${XDG_CACHE_HOME:-$HOME/.cache}/hyprpanel/tray-compat/girepository-1.0" \
  python3 tests/hyprpanel-tray-compat.py
```

- `hyprpanel-teams-unread.py` checks title parsing, application matching, duplicate
  windows, and query failures. It requires only Python 3 and mocks `hyprctl`.
- `hyprpanel-teams-tray.py` checks tray lifecycle, icon assets, activation, and
  watcher recovery. It requires Python 3 with PyGObject (`python-gobject` on Arch)
  and the Gio/GLib introspection bindings. It mocks desktop commands and D-Bus
  connections; it does not start a watcher on the desktop session bus.
- `hyprpanel-tray-compat.py` checks bare bus names, sender-relative object paths,
  and complete bus-name/object-path registrations. It requires `dbus-run-session`,
  Python 3 with PyGObject, and the private AstalTray 0.1 library and typelib.
  See the [private build instructions](../linux/home/.config/hypr/scripts/README.md#build).
  The test starts a watcher. Always use the isolated D-Bus command above; do not
  set `TRAY_TEST_ISOLATED=1` on the desktop session bus.

The unread suite is portable. Run the tray lifecycle and compatibility suites on
Linux with their dependencies installed. The tests do not contact Teams or Slack.
They do not verify live tray rendering, unread badges, menus, or focus behavior.
Those checks still require a Linux desktop with HyprPanel and the target apps.

# Pi bootstrap checks

Run `python3 tests/pi-bootstrap.test.py` from the repository root. These offline tests use temporary
files and mock commands. They compare Pi workspace paths, package names, dependency declarations,
and links with `common/.pi/package-lock.json`. This static check does not replace a clean frozen
install or validate transitive dependency resolution. They also check package manifest parsing, the Vite+ fallback, install failure
handling, Stow runtime exclusions, legacy Transcribe registration removal after successful Voice installation, and Pi Voice health reports. They check separate OpenAI chat and legacy Painter auth
health commands with mock credentials/statuses. They do not install packages,
change live Pi settings, or download models. They require Python 3, zsh, and jq.
Shell subprocesses use `zsh -f`, a temporary `HOME`, and a minimal environment.
They do not inherit `BASH_ENV`, `ZDOTDIR`, or live Pi configuration. User shell
startup files are not loaded.

# Pi native MCP migration checks

```sh
node --test tests/pi-mcp-migration.test.mjs
```

These checks use temporary project directories. They verify that adapter-managed
servers become native project entries, Ephemeral manifests are archived without
removing other project resources, shared `.mcp.json` files remain in place, and
name conflicts fail without overwriting configurations. They do not connect to MCP
servers or authenticate.

# Pi model alias checks

Run from the repository root with Pi installed:

```sh
pi --no-extensions -e ./tests/pi-model-aliases.test.js --no-skills --no-prompt-templates --no-context-files --no-session -p /test-model-aliases
```

The CLI entrypoint delegates to `common/.pi/test/model-alias-checks.js`, so the shared
checks resolve dependencies inside the Pi workspace, including in clean temporary installs.
The tests load the extension through Pi. They use the real provider serializers with a local `fetch` replacement. They do not send model requests or use real credentials. They check:

- Astra Fast, Astra Ultrafast, and GPT-6.1 Sol Fast model rewriting.
- Correct priority/ultrafast tiers through OpenAI Responses with subscription-shaped auth.
- Omission of unsupported subscription request fields and preservation of Painter’s legacy provider.
- Normal Astra and GPT-6.1 Sol requests without speed tiers.
- Removal of legacy chat aliases and the old Sol Fast selection.
- Reasoning-level translation, including Max and Off.
- Payload callbacks and alias restoration in completed messages.
- The direct `streamSimple` path used for compaction.
- Removal of the Sol 1M model and its compaction exception.

Do not use `--list-models` to run these tests. Pi can hide extension-load errors and exit successfully in that mode.

## OpenAI WebSocket checks

```sh
npm --prefix common/.pi run check
```

The aggregate suite includes `common/.pi/test/openai-websocket.test.mjs`.
These tests use a loopback WebSocket server, synthetic credentials, and Pi's real
Responses serializer/parser. They check reusable full-context requests, routing
hints, session/account/model/tier isolation, concurrency, SSE fallback before send,
no replay after send, cancellation, shutdown, malformed streams, Unicode, images,
tool-result payloads, usage, and request deadlines. They do not contact OpenAI.

The single provider entry remains `gpt6-sol-aliases.ts`; it composes the dedicated
`agent/lib/openai-websocket.ts` transport. The existing offline alias tests continue
to use caller-owned fetch adapters, so they cannot unexpectedly make live requests.
See [transport controls and limitations](../common/.pi/README.md#openai-websocket-transport).

## Subscription quota and reset checks

The aggregate Pi workspace check includes `agent/extensions/usage/test/`:

```sh
npm --prefix common/.pi run check
```

These tests use synthetic credentials and injected HTTP responses. They check
actual-duration Codex labels, sparse updates, dynamic Claude windows, percentage
units, overage exceptions, reset expiry/eligibility, shared query backoff, account
changes, native confirmation cancellation, durable idempotency, and two-process
file locks. An isolated actual Pi CLI invocation checks `/usage` loading.
They do not contact providers or redeem real credits. Live quota endpoints and
reset programs remain unverified. See the [extension notes](../common/.pi/agent/extensions/usage/README.md).

## Astra Fast usage

The existing `common/.pi/agent/extensions/gpt6-sol-aliases.ts` extension handles GPT-6.1 Sol Fast, Astra Fast, and Astra Ultrafast. Do not load a second copy of its provider wrappers.

After `/reload`, select:

```text
/model openai/gpt-6-astra-fast
```

The alias sends `model: "gpt-6-astra"` and `service_tier: "priority"`. Reasoning effort remains a separate setting. The model uses a conservative 272,000-token context window and normal auto-compaction. The extension does not disable threshold auto-compaction.

The rates in `models.json` are standard token rates, not ChatGPT credit accounting. Pi applies its own service-tier cost multiplier. Its displayed cost is an estimate; use OpenAI's usage records for actual charges. [Codex fast mode](https://developers.openai.com/codex/speed/) lists Astra at 2.5 times Standard credit consumption where available.

The workspace `ultrafast-model.test.mjs` also runs the serializer checks and verifies
model metadata, OpenAI subscription auth registration, and the unchanged legacy
provider used by Painter. It also verifies Pi 1.0 grammar-call replay after switching
from Anthropic or a gateway through our alias wrapper. The codemode SDK tests check
safe tool-presence probes, missing-member recovery hints, and preservation of the
codemode documentation path after Anthropic sanitation. They also exercise native
codemode execution through the verbosity renderer hook, caught-error summaries,
expansion, and HTML export. The verbosity workspace tests cover live partial results,
images, prompts, cancellation, resume, and tree reconstruction.
Astra Ultrafast requires Pro 500 or another eligible plan.
A live OpenAI OAuth request completed, but returned the `default` tier rather than
confirming Ultrafast processing. See [configuration and billing notes](../common/.pi/README.md#optional-astra-ultrafast).

## Historical legacy Codex Astra Fast live verification result

A short request through the extension returned HTTP 200 and `ASTRA_OK`:

- Request model: `gpt-6-astra`
- Request service tier: `priority`
- Request reasoning effort: `low`
- Response model: `gpt-6-astra`
- Response service tier: `default`
- Response status: `completed`

This confirms that the alias works and sends the priority request option. It does **not** confirm that the server granted priority processing or improved speed. Pi's Codex provider treats a returned `default` tier as the requested tier for cost estimation, so its cost display is not independent proof of fast mode.
