# Agent Browser Recording Recipes

Use these recipes from the repository root of the app under test so artifact paths stay project-local.

## Start a Scenario

```bash
RUN_DIR=".pi/artifacts/ui-evidence/$(date +%Y%m%d-%H%M%S)-<slug>"
mkdir -p "$RUN_DIR"

agent-browser open "http://localhost:3000/<route>"
agent-browser wait --load networkidle
agent-browser set viewport 1440 1000
agent-browser snapshot -i
```

Notes:

- Replace `<slug>` with a short scenario name.
- Replace the URL with the project's local dev URL.
- If the project documents a preferred viewport, use it.
- Prefer named sessions only when juggling multiple browser flows.

## Static Before/After Screenshots

Before editing UI code:

```bash
agent-browser screenshot "$RUN_DIR/before.png"
```

After implementing and validating the change:

```bash
agent-browser open "http://localhost:3000/<route>"
agent-browser wait --load networkidle
agent-browser set viewport 1440 1000
agent-browser screenshot "$RUN_DIR/after.png"
```

Useful variants:

```bash
agent-browser screenshot "$RUN_DIR/before-full.png" --full
agent-browser screenshot "$RUN_DIR/after-annotated.png" --annotate
```

## Interaction Recording

Record only the interaction that demonstrates the change:

```bash
agent-browser record start "$RUN_DIR/flow.webm"
agent-browser snapshot -i
# perform interaction with refs, for example:
# agent-browser click @e1
# agent-browser fill @e2 "search text"
# agent-browser press Enter
agent-browser wait --load networkidle
agent-browser record stop
```

If the recording should include initial navigation:

```bash
agent-browser record start "$RUN_DIR/flow.webm" "http://localhost:3000/<route>"
agent-browser wait --load networkidle
# perform interaction
agent-browser record stop
```

## Interaction Guidelines

- Prefer refs from `agent-browser snapshot -i` over selectors.
- Re-snapshot after navigation or meaningful DOM changes because refs can become stale.
- Prefer semantic waits:
  - `agent-browser wait --load networkidle`
  - `agent-browser wait --url "**/dashboard"`
  - `agent-browser wait --text "Saved"`
  - `agent-browser wait @e1`
- Avoid fixed sleeps unless there is no stable signal.
- Prefer `fill` for text fields unless the behavior depends on key-by-key typing.

## Optional Diff Screenshot

If visual diffing is useful and `agent-browser diff screenshot` is available:

```bash
agent-browser diff screenshot --baseline "$RUN_DIR/before.png"
```

Save any diff output into the same run folder when possible.

## Troubleshooting

- If the app is not running, start the documented dev server in a separate terminal or tmux pane.
- If auth is required, reuse an existing browser profile/session or follow the project's auth setup notes.
- If screenshots show loading states, wait for a stable text, URL, or element before capturing.
- If animations make evidence noisy, wait for the final state or use screenshots instead of video.
