# Handoff: Run Pi subagents in Herdr

## Objective

Change the custom Pi `Agent` tool so that, when the parent Pi session is running inside Herdr, every subagent runs as a separate interactive Pi process in a Herdr-managed terminal. The parent must still receive structured results and retain the current model/tool/permission/background-job behavior.

The outcome should provide both:

1. **Human observability:** each child is a real Pi TUI that can be watched, focused, read, or interacted with through Herdr.
2. **Programmatic orchestration:** the parent `Agent` tool receives a reliable structured result without scraping terminal output.

Outside Herdr, preserve the current in-process SDK backend as a fallback.

## Repository and environment

Repository: personal dotfiles managed with GNU Stow.

Relevant paths:

```text
common/.pi/agent/extensions/amp-subagents/
├── index.ts
├── runtime.ts
├── agents.ts
├── readonly.ts
├── repo-cache.ts
├── agents/*.md
└── test/*.test.ts

common/.pi/agent/extensions/herdr-agent-state.ts
common/.config/herdr/config.toml
common/.local/bin/pi
```

Project rules:

- Read the root `AGENTS.md`, `common/AGENTS.md`, and `common/.pi/agent/AGENTS.md` first.
- Edit tracked files under `common/`; do not edit their deployed `$HOME` symlinks directly.
- Do not overwrite unrelated working-tree changes. The repository is currently very dirty.
- `common/.pi/agent/extensions/herdr-agent-state.ts` is generated and managed by Herdr. Do not put custom behavior in it.
- Do not commit unless explicitly requested.

Versions at the time of investigation:

- Pi: `0.80.5`
- Herdr: `0.7.3`
- Herdr Pi integration: `v4`, current
- Herdr upstream tag inspected: `v0.7.3`
- Herdr upstream commit: `299dd4163a96381ec2d8e5bde13d7ba6d6432373`

The user currently has uncommitted model updates in the built-in agent definitions and an uncommitted Herdr integration v4 update. Preserve them.

## Required reading

Before implementation, read these files completely:

### Current implementation

- `common/.pi/agent/extensions/amp-subagents/index.ts`
- `common/.pi/agent/extensions/amp-subagents/runtime.ts`
- `common/.pi/agent/extensions/amp-subagents/agents.ts`
- `common/.pi/agent/extensions/amp-subagents/readonly.ts`
- All files under `common/.pi/agent/extensions/amp-subagents/agents/`
- Existing tests under `common/.pi/agent/extensions/amp-subagents/test/`
- `common/.pi/agent/extensions/herdr-agent-state.ts`
- `common/.config/herdr/config.toml`
- `common/.local/bin/pi`

### Installed Pi docs

Resolve the installed Pi package dynamically if the path has changed. At investigation time it was under:

```text
/home/thxgg/.vite-plus/js_runtime/node/24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/
```

Read:

- `README.md`
- `docs/extensions.md`
- `docs/sdk.md`
- `docs/json.md`
- `docs/rpc.md`
- `examples/extensions/subagent/README.md`
- `examples/extensions/subagent/index.ts`

Important Pi facts:

- Interactive mode has `ctx.mode === "tui"` and `ctx.hasUI === true`.
- JSON and print modes have `ctx.hasUI === false`.
- `agent_settled` is the correct completion event after retries, compaction retries, and queued continuations are exhausted.
- Explicit CLI extensions can be loaded with `-e`.
- CLI options support `--model`, `--thinking`, `--tools`, `--exclude-tools`, `--append-system-prompt`, `--name`, `--approve`, and `--no-approve`.
- Pi explicitly recommends spawning separate Pi instances in terminal multiplexers for observable subagents.

### Herdr docs/source

Public docs:

- <https://herdr.dev/docs/agents/>
- <https://herdr.dev/docs/cli-reference/>
- <https://herdr.dev/docs/socket-api/>
- <https://herdr.dev/docs/integrations/>

Prefer the Herdr CLI wrappers over the raw socket API unless a long-lived event subscription is truly needed.

If source confirmation is needed, use Pi's `repo_cache` for:

```text
https://github.com/ogulcancelik/herdr @ v0.7.3
```

Important Herdr facts:

- `herdr agent start` launches an argv command in a real terminal and returns structured JSON.
- An agent may be placed in a specific workspace/tab.
- `agent.start` requires a unique agent name.
- Herdr-managed environment variables are injected into child processes.
- The official Pi integration is lifecycle authority for interactive Pi sessions.
- Agent names are valid control targets and are preferable to retaining guessed pane IDs.
- Herdr CLI calls inherit `HERDR_SOCKET_PATH`, so they address the same named/default session as the parent.
- A direct argv-backed pane normally closes on Linux when the launched command exits. Keeping the interactive child Pi process alive at idle avoids losing the pane at completion.

## Current architecture and why it is invisible

`runtime.ts` currently creates each child with `createAgentSession()` in the parent process:

- child session is isolated in context but not in process/terminal;
- `SessionManager.inMemory()` means no child Pi session file;
- jobs live in an in-memory `Map`;
- event subscription collects messages, tool calls, usage, files, validation, and artifacts;
- `session_shutdown` aborts every active job.

The official Herdr Pi extension intentionally reports only a root UI session. An SDK child has no independent TUI, PTY, Herdr pane ID, or lifecycle authority. Do not try to report concurrent child state through the parent pane; children would overwrite one another and make the parent pane state incorrect.

## Chosen design

Use a **Herdr-launched interactive Pi child plus an explicit child bridge extension and a persistent job store**.

```text
Parent Agent tool
  ├─ validate/discover agent definition
  ├─ persist job spec + delegated prompt (0600)
  ├─ create a Herdr tab in the parent's workspace
  ├─ start an interactive Pi child with `herdr agent start`
  ├─ close the tab's temporary root shell pane
  └─ watch the persistent job state for foreground calls

Child Pi TUI
  ├─ is visible and interactive in Herdr
  ├─ uses the official Herdr Pi lifecycle integration
  ├─ loads an explicit child bridge extension
  ├─ child bridge enforces maxTurns and permissions
  ├─ child bridge records structured progress/result atomically
  └─ remains open and idle after completion for inspection
```

Do not use terminal scraping as the result transport.

Do not use `pi --mode json -p` as the primary child process. JSON/print mode disables the normal Pi TUI, has `ctx.hasUI === false`, weakens native lifecycle reporting, and exits after completion.

Do not use Pi RPC over the Herdr PTY as the primary design. It would require sending and parsing JSON through terminal echo/wrapping and gives a poor human interface.

## Backend selection

Keep both backends:

- When `HERDR_ENV === "1"` and Herdr connection variables are available, use the Herdr backend.
- Outside Herdr, use the existing in-process SDK backend.
- If Herdr is expected but a Herdr CLI operation fails, return a clear launch/orchestration error. Do not silently fall back to an invisible in-process child.

Refactor the existing implementation rather than deleting it. A reasonable split is:

```text
amp-subagents/
├── runtime.ts              # shared job API/backend routing
├── in-process-runtime.ts   # extracted existing createAgentSession implementation
├── herdr-runtime.ts        # tab/agent orchestration
├── child-bridge.ts         # explicitly loaded in child Pi
├── job-store.ts            # persistent atomic state
├── prompt.ts               # shared delegated prompt composition if useful
└── test/
```

Exact filenames may differ, but keep modules focused.

## Herdr placement

Default to one dedicated tab per subagent in the **same Herdr workspace** as the parent. This gives the child a full-size TUI and avoids creating workspace-level clutter.

Use the parent's `HERDR_WORKSPACE_ID`; never guess the active workspace. Suggested flow:

1. Create a tab without focus:

   ```bash
   herdr tab create \
     --workspace "$HERDR_WORKSPACE_ID" \
     --cwd "$job_cwd" \
     --label "search:a1b2c3" \
     --no-focus
   ```

2. Parse:

   - `result.tab.tab_id`
   - `result.root_pane.pane_id`

3. Start the child in that tab:

   ```bash
   herdr agent start "pi-search-a1b2c3" \
     --cwd "$job_cwd" \
     --tab "$tab_id" \
     --no-focus \
     -- <child Pi argv...>
   ```

4. Parse `result.agent`, including its name, terminal ID, pane ID, tab ID, workspace ID and initial status.
5. Close the temporary root shell pane. Failure to close the temporary pane should become a warning, not cause a running child to be treated as failed.
6. If child launch fails, close the temporary tab and mark the job failed.

Use argv arrays with `pi.exec()` or `execFile()`. Never interpolate task or path text into a shell command.

Suggested names:

- Job ID: retain `agent-<8 hex>` or another stable unique ID.
- Herdr agent name: `pi-<agent-name>-<job-suffix>`.
- Tab label: `<agent-name>:<job-suffix>`.

Use the unique Herdr agent name as the durable control target. Store returned pane/tab/terminal IDs for display and diagnostics, but re-resolve the agent by name before cancellation/focus operations where possible.

## Child Pi invocation

The child should be a normal interactive Pi process with its delegated task as the initial prompt. Conceptually:

```text
pi
--name <agent/job label>
--model <provider/model>              # when configured
--thinking <level>                    # when configured
--tools <comma-separated tools>       # when configured
--exclude-tools <comma-separated>     # Agent plus definition exclusions/denials
-e <absolute child-bridge.ts>
--append-system-prompt <prompt file>
--approve | --no-approve
Task: <delegated task>
```

Use the same robust Pi executable resolution approach as Pi's official subprocess subagent example: prefer the currently executing Pi script/runtime when valid, otherwise use `pi` from `PATH`. Avoid relying only on the themed wrapper if the Herdr server's inherited `PATH` could be stale.

### Prompt composition

Preserve the current delegated prompt contract from `composeAgentPrompt()`:

- agent name;
- return mode;
- source;
- max turns;
- agent system prompt;
- explicit parent/child contract;
- delegated task as the initial user prompt.

Write the appended system prompt to a job-owned file with mode `0600`. Keep it until the child has started and preferably until explicit cleanup, so startup/recovery does not race file deletion.

### Project trust

Keep project-agent confirmation exactly as today.

Separately, propagate Pi project trust:

- if `ctx.isProjectTrusted()` is true, pass `--approve`;
- otherwise pass `--no-approve` unless a deliberate visible child trust prompt is chosen and documented.

Explicit `-e child-bridge.ts` remains loadable independently of project trust.

## Child bridge extension

Create an extension loaded explicitly only by Herdr child processes. Pass it a job-spec path through a custom environment variable such as:

```text
PI_SUBAGENT_JOB_SPEC=/absolute/path/to/spec.json
```

Set that variable with repeated `herdr agent start --env KEY=VALUE` arguments, not shell exports.

The bridge should be inert when the job-spec environment variable is absent, so accidental global loading is harmless.

### Bridge responsibilities

1. Read and validate a versioned job specification.
2. On `session_start`, write queued/running metadata including child session ID/path when available.
3. On `agent_start`, mark the job running.
4. Subscribe to:
   - `tool_execution_start`
   - `tool_execution_end`
   - `message_end`
   - `turn_end`
   - `agent_settled`
   - `session_shutdown`
5. Collect the same result information the current runtime collects:
   - final summary;
   - files read;
   - files changed;
   - validation commands;
   - artifacts;
   - usage totals;
   - tool calls and statuses;
   - stop reason/error message.
6. Reuse the current permission guard so `edit`, `write`, and bash policy remain enforced in the child.
7. Enforce `maxTurns` with extension lifecycle APIs and record a clear max-turn termination reason.
8. On `agent_settled`, atomically write `completed`, `failed`, or `cancelled` plus the structured result.
9. If the child exits unexpectedly, leave enough state for the parent to classify it as failed instead of waiting forever.

Use `agent_settled`, not only `agent_end`, as the successful completion boundary.

### Avoid nested subagents

Always include `Agent` in child exclusions unless an explicit future workflow opts in. Preserve the current system instruction that children do not spawn agents.

Fix the current edge case where `disallowedTools` is ignored when an agent omits a `tools` allowlist. Exclusions must apply whether or not `tools` is defined.

## Persistent job store

Use an XDG-compatible state root:

```text
${XDG_STATE_HOME:-~/.local/state}/pi/subagents/<job-id>/
```

Suggested files:

```text
<job-id>/
├── state.json
├── spec.json
└── prompt.md
```

A single versioned `state.json` is sufficient if it contains both snapshot and result. The design must support parent restart/reload and concurrent child updates.

Requirements:

- directories private to the user;
- files containing tasks/prompts/results mode `0600`;
- atomic temp-file + rename writes;
- tolerate partially missing/corrupt stale jobs without breaking the Agent tool;
- job IDs and paths must not be user-controlled path traversal inputs;
- retain at most a configured/reasonable number of completed records, but never prune running jobs;
- merge disk-backed jobs with any active in-memory controllers;
- `Agent action=list/result/cancel` must work after parent `/reload` or restart when the child still exists.

Extend `AgentJobSnapshot` with optional backend/Herdr metadata, for example:

```ts
backend: "in-process" | "herdr";
herdr?: {
  agentName: string;
  workspaceId: string;
  tabId: string;
  paneId: string;
  terminalId: string;
};
sessionFile?: string;
```

Do not expose absolute prompt/spec paths to the model unless needed for diagnostics.

## Foreground behavior

For a foreground Herdr job:

- launch the child;
- return progress through `onUpdate` based on job-state file changes;
- wait for terminal state in the job store, not terminal text;
- honor the parent tool call's abort signal;
- on abort, request graceful child cancellation;
- return the same structured final `Agent` tool result as the current backend.

A polling loop with a short interval is acceptable initially if it is abort-aware and low overhead. `fs.watch` plus fallback polling is also acceptable. Do not introduce a raw Herdr socket subscriber unless it materially simplifies the design.

## Background behavior

For a background Herdr job:

- return immediately with the job ID, Herdr agent name, and tab/pane information;
- do not retain a stale Pi `ExtensionContext` for completion updates;
- let `Agent action=result` read fresh disk state;
- allow the child to continue when the parent starts a new Pi session, reloads, or exits.

This intentionally differs from the current `session_shutdown` behavior. Do not cancel background Herdr jobs merely because the parent Pi runtime shuts down. Herdr persistence is part of the feature.

Continue to cancel foreground jobs when their tool call is aborted.

## Cancellation, focus, close, and cleanup

Keep existing actions and add explicit Herdr-oriented lifecycle actions if the schema remains manageable:

- `focus`: resolve the Herdr agent name and focus it;
- `close`: close its dedicated tab/pane and mark/retain final job metadata;
- `cleanup`: close completed children and prune their job directories, optionally filtered by age.

At minimum, cancellation must work reliably.

Suggested cancellation flow:

1. Resolve the current agent with `herdr agent get <unique-name>`.
2. Send `esc` with `herdr pane send-keys <pane-id> esc` to trigger Pi abort.
3. Wait briefly for the bridge to record cancellation/settlement.
4. If graceful cancellation times out and the user explicitly requested cancel, close the dedicated tab/pane as a force fallback.

Do not automatically close a completed child when its result is read. The user requested observability, and Herdr's `done` state is useful until the child is viewed.

Update `/agents` command formatting and the custom renderer to show:

- backend;
- Herdr agent name;
- tab/pane ID when available;
- current job status;
- result or error;
- clear hints for focus/close if those actions are implemented.

## Preserve existing behavior

The Herdr backend must retain:

- built-in/user/project discovery and precedence;
- hidden-agent behavior;
- project-agent confirmation;
- foreground/background policy;
- model selection;
- thinking level;
- tool allowlists and exclusions;
- permission guard;
- max turns;
- result summary and usage collection;
- files/artifacts/validation tracking;
- fallback in-process behavior outside Herdr;
- `repo_cache` registration.

Do not regress custom extension tools used by built-in agents:

- `repo_cache`
- `websearch`
- `webfetch`
- `generate_image`

Because the child loads normal user extensions, tool allowlisting/exclusion must be applied after those extensions are discovered by Pi CLI.

## Known caveat: per-agent compaction

The current in-process runtime applies per-agent `compaction.reserveTokens` and `keepRecentTokens` through `SettingsManager`. Pi CLI does not expose equivalent per-run flags.

For the first implementation:

- use normal Pi/global compaction settings in Herdr children;
- document this behavior difference;
- do not build a complicated custom SDK-backed TUI launcher unless required by tests or the user.

Keep the existing exact behavior in the non-Herdr backend.

Also note that `contextWindow` and `maxTokens` fields currently present in `librarian.md` are ignored by `agents.ts`. Either leave them explicitly documented as unsupported or add deliberate parsing/behavior in a separate focused change; do not pretend they already work.

## Error handling and races

Handle these cases explicitly:

- Herdr tab creation fails.
- Agent start fails after tab creation.
- Temporary root pane close fails after agent start.
- Child bridge fails to load.
- Child exits before producing a result.
- Parent restarts while child is running.
- Child is manually closed by the user.
- Stored pane/tab IDs become stale.
- Herdr agent name cannot be resolved.
- Job-state file is malformed or temporarily absent during atomic replacement.
- Two parents attempt to act on the same job.
- Parent abort occurs during launch.
- A project-agent confirmation is declined.

Never wait indefinitely without a way to observe failure. For foreground jobs, combine bridge state with periodic `herdr agent get` checks or a generous watchdog so a vanished child becomes a failed job.

## Testing strategy

The current test suite uses `node:test` and `node:assert`.

Add focused unit tests for pure logic:

- backend selection;
- unique Herdr naming;
- Herdr CLI argv construction;
- parsing `tab create` and `agent start` responses;
- cleanup on partial launch failure;
- job-store atomic read/write and corrupt-file handling;
- background job recovery from disk;
- disallowed tools when `tools` is undefined;
- permission/max-turn bridge behavior where testable;
- cancellation command sequence;
- result formatting with Herdr metadata.

Abstract Herdr execution behind a small interface so tests can use a fake executor instead of requiring a live Herdr server.

Suggested test command:

```bash
node --test common/.pi/agent/extensions/amp-subagents/test/*.test.ts
```

Also run any broader extension tests affected by shared helpers.

### Manual integration matrix inside Herdr

Validate all of the following in a real Herdr session:

1. Foreground `search` child appears in a dedicated tab without stealing focus.
2. Herdr shows native `working` while the child runs.
3. Child transitions to Herdr `done`/`idle` after completion and remains inspectable.
4. Parent receives a structured final summary.
5. Background `search` returns immediately and continues visibly.
6. Background job can be retrieved after parent `/reload`.
7. Background job can be retrieved after quitting/restarting the parent Pi pane.
8. Explicit cancellation aborts an active child.
9. A read-only agent cannot edit/write or run a blocked bash command.
10. General `agent` can edit and validate as before.
11. `maxTurns` termination is reported clearly.
12. `librarian` can use `repo_cache`, `websearch`, and `webfetch`.
13. `painter` can use `generate_image`.
14. Project-agent confirmation remains visible and enforceable.
15. Focus/close/cleanup operations affect only the intended child.
16. Starting two same-type agents concurrently produces unique names/tabs.
17. Closing a child manually is detected by the foreground waiter.
18. No Herdr IDs are guessed from list order.

Inspect with:

```bash
herdr agent list
herdr pane list
herdr agent get <name>
herdr agent read <name> --source recent --lines 80
herdr integration status
```

## Acceptance criteria

Implementation is complete when:

- Inside Herdr, every `Agent action=run` launches a separate interactive Pi child in a Herdr terminal.
- Each child is visible in the Herdr agent panel with authoritative Pi lifecycle state.
- Parent and child remain independently usable.
- Foreground and background jobs preserve current semantics except for the documented persistence improvement.
- Parent obtains structured results without scraping terminal text.
- Background jobs survive parent Pi lifecycle replacement and can be rediscovered.
- Cancellation works and cannot target the wrong child.
- Completed children remain inspectable until explicitly closed/cleaned.
- Outside Herdr, the existing in-process backend still works.
- Existing and new tests pass.
- No unrelated dirty working-tree changes are modified.

## Implementation order

1. Re-read current code/docs and inspect the dirty diff.
2. Add/fix pure shared job/tool normalization behavior, including unconditional exclusions.
3. Extract the existing in-process runner without semantic changes.
4. Implement the versioned atomic job store and tests.
5. Implement the inert-by-default child bridge and tests.
6. Implement a fakeable Herdr CLI client and response parsers.
7. Implement dedicated-tab launch and rollback.
8. Route `Agent` runs to Herdr under `HERDR_ENV=1`.
9. Implement foreground waiting and abort propagation.
10. Implement background persistence/recovery.
11. Implement result/cancel, then optional focus/close/cleanup.
12. Update renderers and `/agents` output.
13. Run unit tests.
14. Perform the real Herdr manual integration matrix.
15. Report exact files changed, tests run, remaining caveats, and any deferred cleanup.

## Out of scope

- Modifying Herdr itself.
- Modifying the Herdr-managed Pi integration.
- Replacing Herdr CLI wrappers with a custom raw socket client without a demonstrated need.
- Building a general distributed job scheduler.
- Automatically merging concurrent editing-agent changes.
- Treating the read-only policy as an operating-system security sandbox.
- Solving ignored `contextWindow`/`maxTokens` fields unless done as a clearly separated small fix.

## Kickoff prompt

> Implement the Herdr-backed Pi subagent plan in `plans/herdr-backed-pi-subagents.md`. Treat that document as the authoritative design and acceptance checklist. Start by reading the required repository instructions, current subagent files, installed Pi docs, and relevant Herdr docs/source listed there. Inspect the dirty working tree and preserve all unrelated changes. Implement autonomously through tests and real Herdr validation where possible, but do not commit or push. Keep the existing in-process backend as the non-Herdr fallback, do not edit the Herdr-managed integration, and finish with a concise report of files changed, verification performed, remaining risks, and any acceptance criteria not validated.
