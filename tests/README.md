# Shared configuration checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/common-config.test.py
```

These checks use temporary homes. They check retired Amp/theme configuration,
Docker PATH guards, PostgreSQL history, and editor setup with stubbed LSP/DAP
interfaces. They do not start language servers or install editor plugins.

# Root command and deployment safety checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/dot-safety.test.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/stow-safety.test.py
```

These checks use temporary homes and mock commands. They verify scoped deployment,
read-only listing, link ownership and backups, and root CLI behavior without changing
the live deployment.

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
commands. The panel launcher tests also require `awk` and `base64 --decode`.
Their shell subprocesses use a temporary `HOME` and a minimal environment. They
do not inherit `BASH_ENV`, exported shell functions, or desktop session variables.
The recording tests use a temporary recording state file and a mock action helper.
The panel tests check both fallback failures and the complete generated patch.

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
files and mock commands. They check package manifest parsing, the Vite+ fallback, install failure
handling, Stow runtime exclusions, and Pi Transcribe health reports. They do not install packages,
change live Pi settings, or download models. They require Python 3, zsh, and jq.
Shell subprocesses use `zsh -f`, a temporary `HOME`, and a minimal environment.
They do not inherit `BASH_ENV`, `ZDOTDIR`, or live Pi configuration. User shell
startup files are not loaded.

# Pi model alias checks

Run from the repository root with Pi installed:

```sh
pi --no-extensions -e ./tests/pi-model-aliases.test.js --no-skills --no-prompt-templates --no-context-files --no-session -p /test-model-aliases
```

The tests load the extension through Pi. They use the real provider serializers with a local `fetch` replacement. They do not send model requests or use real credentials. They check:

- Astra Fast and Sol Fast model rewriting.
- Priority processing for fast aliases only.
- Normal Astra requests without priority processing.
- Reasoning-level translation, including Astra Max.
- Payload callbacks and alias restoration in completed messages.
- The direct `streamSimple` path used for compaction.
- Removal of the Sol 1M model and its compaction exception.

Do not use `--list-models` to run these tests. Pi can hide extension-load errors and exit successfully in that mode.

## Astra Fast usage

The existing `common/.pi/agent/extensions/gpt56-sol-aliases.ts` extension handles both Sol and Astra. Do not load a second copy of its provider wrappers.

After `/reload`, select:

```text
/model openai-codex/gpt-6-astra-fast
```

The alias sends `model: "gpt-6-astra"` and `service_tier: "priority"`. Reasoning effort remains a separate setting. The model uses a conservative 272,000-token context window and normal auto-compaction. The extension does not disable threshold auto-compaction.

The rates in `models.json` are standard token rates, not ChatGPT credit accounting. Pi applies its own service-tier cost multiplier. Its displayed cost is an estimate; use OpenAI's usage records for actual charges. [Codex fast mode](https://developers.openai.com/codex/speed/) lists Astra at 2.5 times Standard credit consumption where available.

## Live verification result

A short request through the extension returned HTTP 200 and `ASTRA_OK`:

- Request model: `gpt-6-astra`
- Request service tier: `priority`
- Request reasoning effort: `low`
- Response model: `gpt-6-astra`
- Response service tier: `default`
- Response status: `completed`

This confirms that the alias works and sends the priority request option. It does **not** confirm that the server granted priority processing or improved speed. Pi's Codex provider treats a returned `default` tier as the requested tier for cost estimation, so its cost display is not independent proof of fast mode.
