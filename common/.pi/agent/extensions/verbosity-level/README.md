# Verbosity level

Active Pi extension. Verbosity is a global, persistent preference. Low verbosity
groups built-in and repository web-tool rows and summarizes codemode scripts.
It uses Pi 1.0.2's `registerToolRenderer()` without changing model messages,
tool execution, permissions, or results.

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
- Each codemode script has its own summary, such as `Codemode · Explored 3 reads`.
  Counts come from native result details, not from parsing the script. Nested tools,
  MCP calls, and model calls appear in these counts but do not become separate rows.
- Expand a codemode summary to see the full native script, nested-call details,
  and output. Caught nested failures remain marked `FAILED`, even if the script
  succeeds. Script failures and cancellations have separate status labels.
- Images and user-input prompts keep normal codemode rows. Missing or malformed
  saved details fall back to native rendering instead of hiding output.

## Execution scope

The extension registers a renderer resolver, never executable tools. It composes
with `next()` so remote, sandbox, SDK, and other extension tool owners keep their
execution and native renderers. Web tools no longer import the verbosity adapter.

`PI_VERBOSITY_BUILTINS=0` and `PI_VERBOSITY_WEB=0` remain optional display opt-outs.
They are no longer needed to protect remote or SDK execution. Set them before
extension loading. Codemode summaries remain available independently.

Default verbosity restores native output. Non-TUI runs do not use verbosity UI
or preferences. HTML exports retain native result content in their separate
call/result slots.

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

The workspace targets Pi 1.0.2. Pi owns transcript layout and scrollback. Regular terminal
scrollback can retain previous rendering. Only fullscreen mode supports mouse
interaction. Reload/resume reconstructs active-branch groups, including compaction
context; group expansion is session-local. Nested codemode calls are summarized
inside their parent only. Direct Agent, workflow, and MCP rows stay native.
The details viewer reads saved results on demand with bounded previews.
