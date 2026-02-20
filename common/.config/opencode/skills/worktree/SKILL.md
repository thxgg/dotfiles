---
name: worktree
description: Manage git worktree sessions with forked OpenCode sessions.
---

# Worktree Session Helper

Use the plugin tools (`wt_create`, `wt_list`, `wt_resume`, `wt_finish`) instead of
reimplementing git worktree lifecycle logic in prompt text.

## Intent Routing

- No args, branch, story ID, or Shortcut story URL -> `wt_create`
- `list` -> `wt_list`
- `resume [ref]` -> `wt_resume`
- `finish [ref]` -> `wt_finish`
- `finish [ref] --remove` -> `wt_finish` with `remove=true`

## Story Branch Resolution

When input is a story ID or Shortcut URL:

1. Try `mcp__shortcut__stories-get-branch-name` if Shortcut MCP is available.
2. If unavailable, the story has no branch, or the call fails, fall back to `sc-<story-id>`.
3. Do not block the workflow on Shortcut availability.

## Behavioral Defaults

- `finish` is non-destructive by default.
- `finish --remove` removes only the worktree path; it does not delete the branch.
- Always surface fallback commands when terminal auto-open fails.
