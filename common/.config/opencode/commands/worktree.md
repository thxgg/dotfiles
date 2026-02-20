---
description: Manage forked worktree sessions
agent: build
---

Use the `wt_create`, `wt_list`, `wt_resume`, and `wt_finish` plugin tools.

Input: `$ARGUMENTS`

Routing:
- Empty input or `<branch|story-id|shortcut-url>` -> `wt_create`
- `list` -> `wt_list`
- `resume [ref]` -> `wt_resume`
- `finish [ref]` -> `wt_finish`
- `finish [ref] --remove` -> `wt_finish` with `remove=true`

Branch resolution:
- If the first value looks like a Shortcut story ID or URL:
  1) Try `mcp__shortcut__stories-get-branch-name` when available.
  2) If unavailable or missing branch, fall back to `sc-<story-id>`.
- Do not block on Shortcut availability.

Constraints:
- `finish` is non-destructive by default.
- Never delete the git branch automatically.
- If terminal auto-open fails, always return the fallback command.
