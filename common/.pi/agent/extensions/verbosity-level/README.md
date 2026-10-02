# Verbosity level

Active Pi extension. Verbosity is a global, persistent preference. Low verbosity
groups standard local built-ins and opted-in repository web tools without changing
model messages, tool execution, permissions, or results.

```text
/verbosity low
/verbosity default
/verbosity status
```

Both mode commands save `~/.pi/agent/verbosity.local.json`. Open interactive
sessions that share the same agent directory pick up changes within about 250 ms,
even while idle. New, resumed, forked, and reloaded sessions read the saved choice.
`PI_CODING_AGENT_DIR` changes the shared preference directory.

`pi --verbosity default` saves native rows as the global choice at startup;
`pi --verbosity low` saves grouped rows. Reload does not replay an old CLI choice.
Concurrent changes use the last completed atomic write. The file is machine-local,
outside caches, and excluded from Git and Stow.

With no saved preference, the first session uses `low` without writing a file.
Archived Focus state stays ignored. Invalid or unreadable preferences produce an
error, not a silent reset. An open session keeps its last known mode; a new session
uses native rows until the preference is repaired. A failed save leaves the active
mode unchanged. RPC, JSON, and print modes do not read, save, or watch preferences.

The two choices are `low` and `default`. `/focus` is removed. Invalid CLI values
disable grouping and show an error; they do not terminate Pi.

## Interaction

- A summary such as `Explored 1 read, 1 search` groups adjacent calls.
- Click the summary to open or close the group. The summary remains visible.
- Open groups contain native tool rows, without a duplicate action list.
- Click a member row to expand or collapse its output, not the group.
- Ctrl+O controls global expansion.
- Pending summaries show an arrow followed by Pi's animated braille spinner.
- Settled success has no `completed` label. Errors and cancellations stay explicit.
- Images and input requests stay normal. Thinking blocks, assistant/user text, and
  unsupported tools separate groups. Tool groups stay in transcript order, even
  when thinking is hidden. Agent, workflow, and MCP tools are not adapted.
- Native codemode owns its nested-call display. Nested execution events do not
  join direct-tool groups or hide later direct rows.

## Execution scope

Built-in delegates use Pi's public standard-local factories. Do not use these
with remote/sandbox execution, SDK base overrides, or competing built-in execution
extensions. Set `PI_VERBOSITY_BUILTINS=0` before starting those processes to disable
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
./common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/run.sh
./common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/check.sh
npm run check --prefix common/.pi/agent/extensions/verbosity-level
npm run check --prefix common/.pi/agent/extensions/web-tools
```

Tests use ignored local peer dependency links. Do not commit dependency trees.
The lab is nested under `tools/`, outside automatic extension entry discovery.
Deployment uses `safe-stow.sh`; committing these files does not deploy them.

## Limits

The workspace targets Pi 1.0.0. Pi owns transcript layout and scrollback. Regular terminal
scrollback can retain previous rendering. Only fullscreen mode supports mouse
interaction. Reload/resume reconstructs active-branch groups, including compaction
context; group expansion is session-local. No global arbitrary-tool rendering hook
exists. The details viewer reads saved results on demand with bounded previews.
