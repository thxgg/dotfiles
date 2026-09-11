# Tool verbosity

Active Pi extension. Low verbosity is the default for each session. It groups
standard local built-ins and opted-in repository web tools without changing model
messages, tool execution, permissions, or results. Saved settings from the archived
Focus version are ignored. Mode changes are session-local.

```text
/verbosity low
/verbosity normal
/verbosity status
```

`pi --verbosity normal` starts with native rows. `/focus on|off|status|details`
remains available for compatibility. Invalid CLI values disable grouping and show
an error; they do not terminate Pi.

## Interaction

- A summary such as `Explored 1 read, 1 search` groups adjacent calls.
- Click the summary to open or close the group. The summary remains visible.
- Open groups contain native tool rows, without a duplicate action list.
- Click a member row to expand or collapse its output, not the group.
- Ctrl+O controls global expansion.
- Pending summaries show an arrow followed by Pi's animated braille spinner.
- Settled success has no `completed` label. Errors and cancellations stay explicit.
- Images and input requests stay normal. Assistant/user text and unsupported tools
  separate groups. Agent, workflow, and MCP tools are not adapted.

## Execution scope

Built-in delegates use Pi's public standard-local factories. Do not use these
with remote/sandbox execution, SDK base overrides, or competing built-in execution
extensions. Set `PI_FOCUS_BUILTINS=0` before starting those processes to disable
local delegate registration. This guard must be set before extension loading.
Ownership checks fail open to normal rows when another owner replaces a tool.

Web tools adapt rendering by default. `PI_VERBOSITY_WEB=0` disables their adapter.
Normal verbosity restores native rendering. Non-TUI runs do not use verbosity UI;
local delegate registration still occurs unless explicitly disabled.

## Iteration lab

The retained [lab](tools/verbosity-lab/README.md) uses real Pi components and
synthetic events, with no model requests or tool execution.

From the repository root:

```sh
./common/.pi/agent/extensions/focus-mode/tools/verbosity-lab/run.sh
./common/.pi/agent/extensions/focus-mode/tools/verbosity-lab/check.sh
npm run check --prefix common/.pi/agent/extensions/focus-mode
npm run check --prefix common/.pi/agent/extensions/web-tools
```

Tests use ignored local peer dependency links. Do not commit dependency trees.
The lab is nested under `tools/`, outside automatic extension entry discovery.
Deployment uses `safe-stow.sh`; committing these files does not deploy them.

## Limits

Tested with Pi 0.85.1. Pi owns transcript layout and scrollback. Regular terminal
scrollback can retain previous rendering. Only fullscreen mode supports mouse
interaction. Reload/resume reconstructs active-branch groups, including compaction
context; group expansion is session-local. No global arbitrary-tool rendering hook
exists. The details viewer reads saved results on demand with bounded previews.
