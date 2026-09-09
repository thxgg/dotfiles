# Focus mode

Conversation-focused terminal rendering for Pi **0.85.1**. No Pi core changes.

## Try it without deployment

From the repository root, start a separate Pi session:

```bash
PI_FOCUS_BUILTINS=1 pi -e ./common/.pi/agent/extensions/focus-mode/index.ts
```

Use this option only with Pi's standard local `read`, `ls`, `grep`, and `find` execution. Do not combine it with remote, sandbox, or other execution overrides for those tools. The repository's event-based policies, including `pi-cloak`, still run.

Without `PI_FOCUS_BUILTINS=1`, Focus checks `getAllTools().sourceInfo` at session start. It only replaces standard built-ins. This is safer for unknown extension sets, but has a historical reload limit described below.

Focus starts **off** until you select a mode:

```text
/focus on
/focus off
/focus status
/focus details
/focus details <group-id>
```

The details viewer starts at the latest group. Use Left/Right for groups, Up/Down for calls, Enter for the result, and Escape to go back or close. Space changes inline expansion. Result pages support Up/Down and PageUp/PageDown. The viewer uses Pi's configured selection keys.

Fullscreen mode supports click expansion without taking keyboard focus. `Ctrl+O` keeps Pi's tool-expansion behavior. No new shortcut is registered, so existing shortcuts cannot conflict.

## Deployment

Files belong in `common/`. Do not copy them into `$HOME`.

This change does not run Stow or change global settings. When ready, use the repository's `./safe-stow.sh`, then start a new Pi session. The web integration is optional. It resolves the adapter relative to the real source file, so individual Stow links work before `focus-mode/` is deployed. If the adapter is absent or cannot load, web tools keep their original rendering. Check for a second `focus` command with `/focus status`; Pi assigns numeric command suffixes for conflicts.

The selected mode is saved atomically in:

```text
<getAgentDir()>/.cache/focus-mode/state.json
```

This is machine-local state. Group membership and expansion are session-local. `PI_FOCUS_BUILTINS=1` is an explicit process option, not a saved global override.

## Coverage

Grouped operations:

- Standard `read`, `ls`, `grep`, and `find`, when available.
- Repository-owned `webfetch` and `websearch`, through explicit adapters. Owner paths must match the active tool's provenance.

Normal rows remain for:

- Images, including image-producing reads and fetches.
- All pending siblings when a user-facing prompt opens. Pi does not identify the requesting call in prompt events, so this rule is conservative.
- Shell commands, edits, writes, MCP, subagents, workflows, and all unadapted tools.

User messages, visible assistant text, unsupported calls, visible custom messages, and custom entries separate groups. Tool-only assistant messages can continue a group. No shell or MCP operation is classified by its name.

## Architecture

The first adapted call hosts an inline activity group. Other members return zero rendered lines with `renderShell: "self"`. Pi 0.85.1 removes the spacer for an empty self-rendered row. This is **not** a widget-only fallback.

The adapter changes rendering only. It retains tool schemas, prompt metadata, execution policy, results, and callbacks. Standard definitions come from Pi's public `create*ToolDefinition()` factories, including their native renderers. The eager read delegate also reads Pi's image-resize setting. Original call and result components share one normal box when Focus is off.

Tracking uses `toolCallId`, assistant source order, and separate execution status. Results that finish out of order do not reorder calls. Duplicate execution/result events do not duplicate calls. Errors appear as a red `FAILED` summary with a direct details command. Cancellation and missing terminal results have separate states.

Reconstruction uses `buildContextEntries()` from the active branch, including retained compaction messages. Details are read on demand from that branch. No result copies are kept in the activity model. Text previews are limited to 64 Ki characters; structured details have traversal, depth, and size limits. Images stay in Pi's original transcript. Use `/focus off` and `Ctrl+O` for native results beyond the preview limit.

Only input-boundary metadata is appended to the session. These custom entries do not enter model context. There are no progress entries, model calls, timers, transcript-container replacements, or terminal-output interception. Event-bus listeners are removed on shutdown.

Theme tokens supply all colors. `accent` is Lavender in the repository's Latte and Mocha themes.

## Limits

- **Historical reload:** Pi 0.85.1 rebuilds rows before `session_start`. `PI_FOCUS_BUILTINS=1` registers adapters early and supports inline reconstruction after `/reload`. Without it, old built-in rows can remain normal after reload; new calls still group. Restart/resume reconstructs them. Web adapters register early in their owning extension.
- **Compatibility:** the eager option explicitly selects standard local execution. Do not enable it when another extension owns those built-in names. Dynamic tool replacement during a run is not a supported integration; unknown group hosts fail open to normal rows.
- Regular terminal scrollback can retain previously printed content after display changes. Focus does not erase terminal scrollback. Pi controls scrolling; Focus does not call scroll or focus APIs during updates.
- Pi controls the placement of text and tool rows within one assistant message. Focus cannot relocate text interleaved with tool calls in that message.
- Inline expansion lists at most 20 calls. The keyboard viewer can inspect every call. Expansion resets on reconstruction; the selected mode persists.
- The viewer shows a snapshot of the selected saved result. Reopen a running call's result after completion to refresh it.
- Arbitrary display-only entries are conservative boundaries. A card inserted during a single streamed assistant message can have different placement during replay because Pi persists the complete assistant message as one entry.
- Non-TUI modes make no Focus UI calls. Without the eager option, they do not register built-in overrides. With it, the standard execution delegates still run normally.

## Validation

```bash
cd common/.pi/agent/extensions/focus-mode
npm install --ignore-scripts --legacy-peer-deps --no-package-lock
# Make the installed Pi peer packages available in node_modules for tests.
npm run check

cd ../web-tools
npm run check
```

For the installed-Pi check in this repository, ignored `node_modules/@earendil-works/` links point to the installed Pi 0.85.1 packages. No installed files were changed. The extension itself has no third-party runtime dependencies beyond Pi's supplied peers.

Automated checks cover 20-call composition with Pi's actual host component, native restoration, streaming events, boundaries, out-of-order completion, duplicates, errors, cancellation, images, prompts, mode persistence, active-branch reconstruction, pre-session reload rendering, non-TUI guards, and bounded previews. Web regression tests verify execution/metadata identity and exact normal-render equality.

Initial terminal validation used a separate offline tmux server and synthetic saved session. It verified regular-mode Latte rendering, keyboard result access, normal restoration with `Ctrl+O`, fullscreen Mocha click expansion, reload with the eager option, and resize to 38 columns.

Additional validation used a real Ghostty window with a transparent PTY input relay, isolated Pi settings, and a deterministic offline provider extension. The provider emitted tool calls through Pi's normal agent loop; the standard `read` tool performed actual file and PNG reads. No network or paid model request was made.

Verified with screenshots and saved event/session assertions:

- PNG output appeared through Ghostty's Kitty image protocol, between separate text-read groups. The image stayed visible with Focus off, after reload, and on regular-mode resume.
- A real `tool_call` permission gate used `ctx.ui.confirm()`. The dialog and pending sibling rows remained visible. Denial and Escape returned a visible blocked result without file content. Approval returned the actual file content. Fullscreen approval/denial and regular-mode Escape were tested.
- Keyboard `/tree` navigation created branch B from an earlier point, returned to branch A, and selected branch A again in regular mode. The details viewer showed the correct branch and original result. Saved-session assertions found no duplicate or wrong-branch calls. Reload preserved the image and permission exceptions.

Test evidence and the temporary fixture are outside Git history in `/tmp/pi-focus-validation/`. These checks cover Ghostty with one PNG fixture and a test permission gate. They do not certify every image format, terminal, or third-party permission extension.
