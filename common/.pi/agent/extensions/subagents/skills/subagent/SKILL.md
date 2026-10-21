---
name: subagent
description: Run and control prompt-driven Pi child sessions. Use for explicitly requested delegated work or a task too large for one context.
---

# Subagents

Use `subagent` through bash. If it is not on PATH, run `node ~/.pi/agent/extensions/subagents/subagent.ts`.
Each child has a separate Pi process and saved session. No named agent types exist.
A name is only a display label. Put the role, evidence, constraints, and stopping condition in the prompt or a text file.

```sh
subagent spawn --name independent-review --tools read,grep,find,ls --no-extensions \
  --prompt "Review the current diff. Do not change files. Report only actionable defects with file references."
subagent spawn --name implementation --file /tmp/task.md \
  --provider openai --model gpt-6-astra --thinking high
subagent status HANDLE
subagent send HANDLE "Focus on cancellation and cleanup"
subagent send HANDLE --follow-up "Now summarize the remaining risks"
subagent wait HANDLE --timeout 120
subagent list
```

- The provider, model, and thinking level inherit from the parent unless overridden.
- Use self-contained prompts. Children do not inherit the parent conversation.
- Use `--cwd PATH` to choose the workspace. The default is the current directory. There are no automatic worktrees or merge actions. Do not run concurrent writers on the same files.
- `--file` reads UTF-8 text into the initial prompt. Use explicit paths and `read` for images.
- Optional isolation: `--tools`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-context-files`. For strict read-only work use `--no-extensions --tools read,grep,find,ls`; tool selection alone does not remove callable MCP tools. These controls are not an OS sandbox.
- Children run in the background. Completion returns to the parent automatically. Use `wait` only when the next action needs the result. A wait timeout does not cancel the child.
- `send` steers active work or starts a new turn when idle. `--follow-up` queues the next turn.
- `rename HANDLE NAME` changes only the display label.
- `/subagent` shows saved results and session paths in the current Pi UI. It does not open another terminal or another writer on the session.
- `stop HANDLE` stops the process and permanently deletes that run's metadata and transcript. Do this only when deletion is intended. Parent shutdown instead suspends runs and preserves history. Resuming the parent restores standalone children idle; interrupted work is not automatically replayed.
- Children cannot delegate. Use the separate `workflow` tool for explicit phases and result passing.
- Use `generate_image` directly for image work. Do not invent a Painter role.

Before delegation, identify the decision this child can change and its distinct evidence. Avoid duplicate investigation. Integrate completed results into a complete, self-contained final answer.
