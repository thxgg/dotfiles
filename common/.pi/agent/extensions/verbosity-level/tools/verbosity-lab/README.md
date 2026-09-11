# Pi verbosity lab

Compare **low** (grouped activity) and **default** (native Pi tool rows).
There is no third level. Expansion is a separate inspection control.

Inspired by [James Long's verbosity iteration tool](https://x.com/jlongster/status/2098150852112359801).
This version uses the installed Pi renderer, not a web imitation.

## Start

From this worktree:

```sh
./common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/run.sh
```

Requires the installed `pi` CLI (tested with 0.85.1). No npm install is needed to
run the viewer. The launcher uses an empty temporary working directory and agent
directory. It disables discovered extensions, skills, prompts, context files,
tools, and session saving. It loads only this viewer and the repository's
Catppuccin Latte theme, with Lavender accents. Temporary state is removed on exit.
No live Pi settings, deployment links, or archived Focus state change.

The preview contains real `UserMessageComponent`, `AssistantMessageComponent`, and
`ToolExecutionComponent` rows. Low output uses the `Activity` and
`activityComponent` directly. Both sides receive the same event prefix. No model
requests or tool execution occur. Native tool definitions supply rendering only.
Execution clocks and edit argument-completion previews are not started.

Use a Latte terminal background for the closest match. Pi themes do not change the
terminal's default background. Your terminal supplies the font (the repository's
Ghostty config uses Berkeley Mono Variable Nerd Font).

## Controls

| Key | Action |
| --- | --- |
| `n` / `p` | Next / previous fixture |
| Left / Right | Previous / next event, including pending tool states |
| `r` / `f` | Reset / finish replay |
| `1` / `2` | Low / default at full width |
| `c` | Side-by-side comparison (81+ terminal columns) |
| Click a low-mode summary | Expand / collapse that group; summary stays visible |
| Click a tool inside an open group | Expand / collapse that tool's output |
| `e` or Ctrl+O | Expand / collapse all original tool rows |
| Mouse wheel | Scroll both panels |
| `w` | Cycle fitted / 38 / 80-column previews |
| Up / Down, `j` / `k` | Scroll both panels |
| PageUp / PageDown | Scroll 15 rows |
| `q` / Escape | Close viewer |

After closing, `/verbosity-lab` reopens it. `/quit` exits the isolated Pi process.
Edit `fixtures.ts`, restart, and use the same controls to inspect changes. Edit the
`render.ts` or `model.ts` to iterate on low-mode rendering itself.

## Explicit activation in a real session

From a **standard-local** Pi CLI environment:

```sh
./common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/run.sh low
./common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/run.sh default
```

These commands load the extension and worktree web tools with `-e`, set
`PI_VERBOSITY_BUILTINS=1` and `PI_VERBOSITY_WEB=1`, and pass `--verbosity low` or `--verbosity default`. They use your normal Pi
configuration and can execute tools when you submit prompts. Do not use them with
remote execution, sandbox delegates, SDK base-tool overrides, or competing built-in
execution extensions. See the extension's README for its ownership limits.
Low verbosity and web adapters are now enabled by default when the extension is
deployed. These explicit launchers let you test the worktree version first.
Mode commands are session-local and ignore archived saved state.

## Custom fixtures

Summaries use comma-separated counts, such as `Explored 1 read, 1 search`.
Settled successful groups have no `completed` suffix. Pending groups keep the
disclosure arrow, followed by Pi's braille spinner. Failures and cancellations remain explicit.

The built-in cases cover exploration, editing, shell commands, failures,
cancellation, unsupported tools, long output, and out-of-order completion.
Three `WIP` cases stay unfinished: batch edits, mixed actions, and web searches.
Use `n`/`p` to select them. Edits and actions show an animated group spinner.
Web searches and fetches use their real web-tool renderers in default mode and
join exploration groups in low mode. No network requests run in the lab.

In the isolated viewer process, load an explicit JSON file:

```text
/verbosity-lab /absolute/path/to/case.json
```

```json
{
  "name": "Small check",
  "events": [
    { "type": "user", "text": "Run the tests." },
    { "type": "call", "id": "test", "name": "bash", "args": { "command": "npm test" } },
    { "type": "result", "id": "test", "text": "3 tests passed", "error": false },
    { "type": "assistant", "text": "All **3 tests** passed." }
  ]
}
```

`boundary` events take `text` and simulate an approval boundary. Calls require
unique IDs. Results must refer to one earlier call. Files are limited to 1 MiB and
2,000 events. Imported text is stripped of terminal control characters.
This version accepts lab fixtures, not arbitrary Pi JSONL session trees. Copy only
sanitized session excerpts into fixtures. It does not scan private session storage.

## Checks

```sh
./common/.pi/agent/extensions/verbosity-level/tools/verbosity-lab/check.sh
```

Checks render every built-in event prefix at 20, 38, 80, and 120 columns in both
levels, collapsed and expanded. They check width bounds, compactness, visible
failure/cancellation, and fixture parsing. They use the real installed Pi loader
and renderer without starting terminal input, model requests, or tools. The check
requires a success marker because Pi can return zero after a command error.

For static checks, use local ignored peer/development dependencies as the archived
extension does. No generated dependency tree belongs in Git.

## Limits

- The comparison toolbar and viewport are lab UI. Transcript rows use Pi components.
- This is a rendering simulation, not an end-to-end provider/tool-execution test.
- Click a summary or use `e` and scrolling. No legacy command hints are shown.
- Unsupported tools use Pi's generic fallback. Owner extensions are not loaded.
- Images, custom owner renderers, session-tree import, and automatic timed playback
  are not implemented. Right-arrow advances deterministic replay.
- Read previews collapse exactly as Pi does. Edit fixtures do not fabricate saved
  diffs or read current files to create them.
