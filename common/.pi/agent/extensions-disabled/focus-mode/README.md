# Focus conversation mode (archived)

This extension is stored in `extensions-disabled/` and is not auto-discovered by Pi.
Active web, Agent, and workflow extensions no longer load its adapters. Their tools
use native rendering. Explicit loading below groups only opted-in local built-ins.
The owner adapter tests apply wrappers explicitly; they do not enable production integration.

No deployment or machine-local state cleanup accompanies this archive move.
The remaining implementation and terminal evidence describe the pre-archive version,
except for the updated paths and coverage below. Restore owner integrations from
commit `73e3ea1` if you reactivate them.

Inline tool activity groups for Pi **0.85.1**. No Pi core changes.

```text
I will check the changes.

▸ Ran 2 commands · completed

The checks passed.

▸ Ran 1 command · completed
```

The first supported row hosts its group **in chat**. Collapsed sibling rows use zero lines. Ctrl+O or a fullscreen click expands the group and shows the original tool rows and results at that position. The separate details viewer is secondary.

## Activation

From the repository root, start a **new, standard-local** Pi process:

```bash
PI_FOCUS_BUILTINS=1 pi -e ./common/.pi/agent/extensions-disabled/focus-mode/index.ts
```

Then use:

```text
/focus on
/focus off
/focus status
/focus details
/focus details <group-id>
```

Focus starts off unless a previous choice was saved. `/focus on` and `/focus status` list the tools that this process can group. Unsupported tools stay normal.

**Built-in opt-in is now required.** Without `PI_FOCUS_BUILTINS=1`, only explicit owning-extension adapters group. Pi 0.85.1 reports some SDK base-tool overrides as `builtin`; provenance alone cannot prove standard local execution. Do not set this option with SDK base overrides, remote tools, sandbox tools, custom operations, spawn hooks, or competing built-in execution extensions. Focus cannot retrieve those execution delegates through the public API. The option registers local factories early, including in non-TUI processes. It does not disable or select active tools.

Standard shell settings (`shellPath`, `shellCommandPrefix`), current cwd, session environment, timeouts, cancellation, file mutation queues, schemas, argument preparation, prompt metadata, and tool-call/result policy hooks remain in use. Event-based repository policies, such as `git-interceptor` and `pi-cloak`, still run. Shell settings and image-resize settings are read from trusted Pi settings when execution starts. SDK in-memory settings are not supported by this local opt-in.

## Controls

- **Ctrl+O:** Pi's existing global tool expansion. No shortcut is replaced.
- **Fullscreen left click:** Toggle a group from its header or an expanded member row. Do not take keyboard focus.
- **`/focus off`:** Restore native call/result rendering. Use Ctrl+O for native expanded output.
- **`/focus details`:** Open the latest group. Left/Right select groups. Up/Down select calls. Enter opens a saved result. Space toggles inline expansion. Escape returns or closes. Result pages support Up/Down and PageUp/PageDown.

Inline expansion shows all member rows. The header lists at most 20 call labels. The details viewer reads results on demand. Text previews have a 64 Ki-character limit; structured previews have traversal and size limits. Original results and details remain in the session. Native renderers may have their own display limits.

## Exact coverage

| Tools | Inline grouping |
| --- | --- |
| Standard `bash` | Yes, with local opt-in. Includes Git, tests, mixed commands, commits, and pushes. No command classification. |
| Standard `edit`, `write` | Yes, with local opt-in. Native file previews and diffs remain available on expansion. |
| Standard `read`, `ls`, `grep`, `find` | Yes, with local opt-in. |
| Repository `webfetch`, `websearch`, `Agent`, `workflow` | No. Active owner integrations were removed when Focus was archived. |
| MCP gateway, MCP scripts, direct MCP tools, namespace proxies | **No.** Inspected, not adapted in this version. Dynamic registration needs an ownership/discovery refresh protocol. |
| `repo_cache`, `powershell`, user `!`/`!!`, other third-party tools | **No.** Normal rows separate groups. |

Shell-only groups use **Ran / Running commands**. Mixed or non-exploration groups use **Activity**. Only the explicit read/search/fetch set uses **Explored / Exploring**. Tool names or command text do not establish that shell or MCP operations are read-only.

Images and all pending siblings associated with an input prompt stay normal. Pi does not identify the requesting call in prompt events, so this exclusion is conservative. Interactive workflow approval can therefore keep its entire call normal. Failures have a visible `FAILED` header and a details command. Cancelled and interrupted calls have separate states.

User messages, visible assistant text, unsupported calls, user shell commands, visible custom messages, and custom entries separate groups. Tool-only assistant messages can continue a group.

## Deployment

Files belong in `common/`. The archived location stays outside Pi's automatic extension discovery. Stow deployment does not activate it. Do not copy files into `$HOME`. This move does not run Stow, reload the active session, or remove existing live links.

The mode is saved atomically at:

```text
<getAgentDir()>/.cache/focus-mode/state.json
```

Group membership and expansion remain session-local. Do not load the extension twice; Pi assigns numeric suffixes to duplicate commands.

## Architecture and API limits

`withFocusRendering()` changes rendering slots only. Owner execution functions and metadata retain their identity. Standard tools come from public `create*ToolDefinition()` factories, including native renderers. Empty self-rendered sibling rows have no spacer in Pi 0.85.1. Failed native rendering falls back to visible text rather than hiding the result.

Calls use `toolCallId`, source order, and independent execution state. Duplicate events do not duplicate calls. Completion order does not reorder calls. Reconstruction reads `buildContextEntries()` from the active branch, including retained compaction messages. No result copies enter the activity model. Only input-boundary metadata is appended as display-only session entries. Focus makes no model calls and does not change model context, results, permissions, usage, or assistant/user text.

Remaining limits:

- Pi has no documented global tool-rendering or execution-delegation hook. Arbitrary tools cannot be grouped safely without owner cooperation.
- Early registration supports reload/resume for opted-in built-ins. Pi rebuilds historical rows before `session_start`; late adapters cannot change those row definitions. Restart/resume is needed after deployment changes.
- Dynamic replacement of a supported owner during a run is not a supported integration. Missing adapted group hosts fail open to normal rows. Initial ownership checks do not authorize taking over another extension's tool.
- Regular terminal scrollback can retain old rendering. Focus does not erase terminal output or control scrolling. Pi decides whether a layout change moves its viewport.
- Pi controls text/tool placement within one assistant message. Focus does not relocate interleaved assistant text.
- Display-only cards inserted during streaming can have a different position on replay because Pi saves a complete assistant message as one entry.
- Expansion resets on reconstruction. The details viewer shows a saved-result snapshot; reopen a running result after it completes.
- Non-TUI modes have no Focus UI or state writes. Local opt-in still registers execution delegates during load. Owning adapters preserve their execution in all modes.

Theme colors use Pi tokens. `accent` remains Lavender in the repository's Latte and Mocha themes.

## Validation of this version

```bash
npm run check --prefix common/.pi/agent/extensions-disabled/focus-mode
npm run check --prefix common/.pi/agent/extensions/web-tools
npm run check --prefix common/.pi/agent/extensions/subagents
npm run check --prefix common/.pi/agent/extensions/workflows
```

Tests use the installed Pi 0.85.1 packages through ignored local peer-package links. No installed package files changed.

Automated tests cover actual bash execution, mutation commands in temporary files, shell settings/environment, timeout, cancellation, edit/write execution and native parity, inline expansion, renderer failures, explicit adapter discovery/collisions/disposal, 20-call composition, boundaries, duplicates, out-of-order results, images, prompt exclusions, reconstruction, non-TUI guards, and bounded previews.

New terminal validation uses a separate tmux server, isolated settings/session storage, and a deterministic offline provider. Actual Git status/diff, shell validation, failure, and cancellation commands run through Pi's agent loop. No paid model calls, repository commits, or pushes run.

Verified: inline shell replacement, assistant boundaries, Ctrl+O, fullscreen mouse expansion, native restoration, reload, 38-column resize, actual `ctx.ui.confirm()` approval and Escape denial, cancellation, keyboard result access, branch B and return to A through the public tree-navigation API, and regular-mode resume. Evidence and fixture: `/tmp/pi-focus-v2/`.

This version does not claim new Ghostty image validation, real MCP execution validation, or child-agent/workflow execution validation. Earlier read/image terminal evidence remains at `/tmp/pi-focus-validation/`; it is not proof of the new coverage.
