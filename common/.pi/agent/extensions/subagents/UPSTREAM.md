# Source and local changes

Based on Mario Zechner's `badlogic/pi-subagent`:
https://github.com/badlogic/pi-subagent

Base commit: `4fc1fe5178d1a2b474794a5ee39e7295844e9d3c`.

`subagent.ts` and `shared.ts` derive from that revision. Keep attribution when updating them.
The selected upstream tree has no LICENSE file and its package is private. Do not assume a redistribution license; resolve permission before publishing this fork as a package.

Local changes:
- Replace tmux with a detached Node supervisor and Pi's native RPC client.
- Keep prompt/file customization, CLI controls, isolated history, and suspend/resume semantics.
- Store runs under XDG state rather than the stowed agent directory.
- Use the current Pi UI for read-only inspection instead of attaching a terminal.
- Share the headless runtime with the existing workflow sandbox.
- Keep the independent repo-cache tool. Remove named agent profiles and automatic worktrees.

The old subagent state directory is left untouched. No migration or deletion of old sessions runs automatically.
