# Pi subagent fork

Prompt-driven, persistent Pi children based on [Mario Zechner's package](UPSTREAM.md).
There are no named agent types, tmux sessions, or Herdr dependencies.

## Interface

- `subagent spawn --name LABEL --prompt TEXT` starts a child with the parent's model and thinking level.
- Repeated `--prompt` and `--file` options compose a task. Files are UTF-8 text.
- `--provider`, `--model`, `--thinking`, `--cwd`, and resource/tool flags customize each run.
- `status`, `list`, `rename`, `send`, `send --follow-up`, `wait`, and `stop` control runs.
- `/subagent` inspects results and session paths in the current Pi UI.
- The extension adds `~/.pi/agent/bin` to its process PATH. Outside Pi, run `node ~/.pi/agent/extensions/subagents/subagent.ts`.

See the bundled [skill](skills/subagent/SKILL.md) for examples and safety limits.
Requires Node with native TypeScript stripping (Node 22.19+ or 24) and the Pi workspace dependencies.

## Runtime

A detached Node supervisor owns each `RpcClient` child and a durable inbox. It starts the installed workspace Pi CLI in RPC mode. It does not execute repository-local launch scripts. The child discovers normal Pi resources unless the caller disables them. No parent conversation is copied.

The supervisor records results at `agent_settled`, after retries and queued work. It fails on unsupported interactive dialogs rather than silently approving them. It watches parent liveness, bounds first response to 45 seconds and each tool to three minutes, and retains diagnostic logs. The process and tool selection are not an OS security sandbox.

Standalone children survive extension reload. Parent shutdown suspends them and keeps history; parent resume relaunches them idle. An interrupted model request is not replayed. A wait timeout leaves the child running. `stop` explicitly removes the run and its transcript. Standalone runs have no automatic concurrency cap. Workflow concurrency is limited separately.

Runs live at `${XDG_STATE_HOME:-~/.local/state}/pi/subagents-v2/`. The old `pi/subagents/` state is not migrated or removed. Each run contains metadata, a Pi JSONL session, an inbox, a settlement snapshot, and a supervisor log. Workflow children also save structured results.

## Workspace policy

Children use the selected working directory directly. No automatic worktree, apply, retain, or discard operation remains. Avoid concurrent writes to the same files. Read-only investigations should disable extensions and allow only read tools. `--tools` alone does not remove callable MCP tools.

Image generation remains a direct `generate_image` tool in the existing image extension. Global prompt guidance replaces the former Painter subagent.

## Checks

```sh
npm --prefix common/.pi/agent/extensions/subagents run check
npm --prefix common/.pi/agent/extensions/workflows run check
```

The runtime tests use real Pi RPC subprocesses with a synthetic offline provider and temporary home. They cover CLI customization, actual local tools, parallel review/synthesis, failure and cancellation, and parent new-session/reload/resume. They verify that reload keeps the child process, resume restores ownership, and completion notifications are delivered once per result. Timer callbacks stop safely if their context expires or state access fails. Tests do not call model providers or use live credentials.
