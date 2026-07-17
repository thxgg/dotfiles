# Ben's Pi Subagent Setup — Research Notes

## Purpose

Reference for future agents comparing Ben's public Pi setup with this dotfiles repository's current Pi subagent implementation.

## Sources inspected

- Upstream repository: `https://github.com/davis7dotsh/my-pi-setup`
- Upstream commit: `d8534d7e6ec6609b7e684a8a0eb2e7a0195115ba`
- Cached source: `/home/thxgg/.cache/pi/librarian/repos/github.com-davis7dotsh-my-pi-setup-964c608df474`
- Local implementation: `common/.pi/agent/extensions/subagents/`
- Local Pi workspace: `common/.pi/package.json`

These findings came from direct source inspection. A delegated librarian comparison was cancelled before returning a report, so do not cite that child as an independent source.

## Executive conclusion

Do not replace the local `subagents` implementation with Ben's implementation. The local system is stronger in durable execution, specialized agent policy, permission handling, project/user agent discovery, and worktree-isolated mutation.

Adopt selected upstream patterns that improve lifecycle correctness and orchestration:

1. CI/typecheck integration for the subagent extension
2. A race-safe global concurrency limit
3. Per-tool and first-response watchdogs
4. Correct child extension startup/shutdown lifecycle
5. Schema-validated structured results
6. Explicit result-consumption semantics
7. A native status/transcript dashboard
8. A separate bounded workflow primitive

## Upstream architecture

Ben's setup contains two distinct systems.

### Standalone subagents

Location: upstream `extensions/subagents/`

The extension exposes separate tools:

- `subagent_spawn`
- `subagent_wait`
- `subagent_cancel`
- `subagent_check`
- `subagent_list`

Entry-point summary: `extensions/subagents/index.ts:1-20`.

A subagent can run through one of three normalized backends:

- Pi SDK in-process session
- Claude Agent SDK
- Codex app-server JSON-RPC process

The backend contract is defined in `extensions/subagents/src/backend.ts:22-66`. Native backend events are normalized into one domain event stream in `extensions/subagents/src/domain.ts:117-208`. The manager folds that stream into snapshots consumed by tools and the TUI.

The manager owns scoped sessions, event pumps, cancellation, result delivery, steering, limits, and cleanup: `extensions/subagents/src/manager.ts`.

### Workflows

Location: upstream `extensions/workflows/`

This is deliberately separate from one-off delegation. A model-authored workflow can use:

- `phase(title)`
- `agent(prompt, options)`
- `parallel([...thunks], { concurrency })`
- an optional schema for structured child output

The contract and examples are in `extensions/workflows/prompt.ts:19-49`.

Workflow orchestration runs in a permission-restricted Node subprocess with a narrow IPC protocol rather than evaluating arbitrary model-authored JavaScript in the parent process: `extensions/workflows/sandbox.ts:76-123`.

## Patterns worth adopting

### 1. Add local validation to the normal Pi workspace scripts

The local extension has a substantial test suite under:

- `common/.pi/agent/extensions/subagents/test/`

However, `common/.pi/package.json` does not include `subagents` in its root `check`, `test`, or `typecheck` scripts. The upstream extension has dedicated scripts in `extensions/subagents/package.json:5-9`, and the upstream root invokes project-wide checks in `package.json:16-20`.

Recommended local change:

- Add a package manifest for `subagents`.
- Add its typecheck and tests to the root Pi scripts.
- Treat this as the first adoption because later runtime changes need reliable regression coverage.

### 2. Add one global, race-safe concurrency cap

Upstream caps active standalone subagents at four. It reserves capacity synchronously before the first asynchronous yield so parallel tool calls cannot race past the limit: `extensions/subagents/src/manager.ts:364-465`.

Coverage exists in `extensions/subagents/manager.test.ts:141-158`.

The local runtime stores jobs globally in `common/.pi/agent/extensions/subagents/runtime.ts:51-71`, but the spawn path at `runtime.ts:261-337` has no equivalent global limit.

Recommended local invariant:

- One semaphore covers both in-process and Herdr jobs.
- Reserve before persistent job initialization or child launch.
- Release in `finally` for success, failure, cancellation, and setup failure.
- Default cap: four.
- Ensure resumed/restarted children also occupy a slot.

### 3. Add child watchdogs without imposing an overall task deadline

Upstream wraps each child tool with an independent timeout in `extensions/shared/tool-call-timeout.ts:31-103`. The wrapper is reapplied at `agent_start` so tools registered dynamically by extensions are covered: `extensions/workflows/runner.ts:122-131`.

Workflow children also require a first assistant response event within 45 seconds, while allowing the run to continue indefinitely after it starts responding: `extensions/workflows/runner.ts:42-46` and associated tests in `extensions/workflows/runner.test.ts:183-213`.

The local in-process runner mainly relies on parent cancellation and `maxTurns`: `common/.pi/agent/extensions/subagents/in-process-runtime.ts:140-179`.

Recommended local defaults:

- Per-tool timeout: approximately three minutes.
- First assistant event timeout: 45–60 seconds.
- No overall wall-clock deadline after useful output begins.
- A timed-out tool should become a recoverable tool error where possible instead of killing the whole child immediately.

### 4. Complete the in-process child extension lifecycle

Upstream explicitly binds child extensions in headless print mode: `extensions/shared/child-session.ts:76-81`.

Before disposal it emits `session_shutdown` once, bounds extension shutdown hooks, and makes disposal idempotent: `extensions/shared/child-session.ts:93-148`.

The local runner creates a resource loader and agent session at `common/.pi/agent/extensions/subagents/in-process-runtime.ts:117-138`, then directly calls `session.dispose()` at lines 195-203.

Recommended local behavior:

1. Bind child extensions after creating the session.
2. On every terminal path, emit `session_shutdown` exactly once.
3. Bound shutdown hooks to roughly five seconds.
4. Dispose even if a hook throws or hangs.
5. Make repeated teardown calls safe.

This matters for child-loaded extensions that hold timers, sockets, subprocesses, or other resources.

### 5. Support schema-validated structured child output

Upstream workflows optionally inject a terminating `structured_output` tool. It validates the caller's schema and captures a typed result: `extensions/workflows/runner.ts:134-193`. The model contract appears in `extensions/workflows/prompt.ts:24-29` and `:56-62`.

Locally, `returnMode` is metadata on an agent definition (`common/.pi/agent/extensions/subagents/agents.ts:24-39`) but does not enforce an output shape. Results remain prose in `common/.pi/agent/extensions/subagents/job-types.ts:43-53`.

Recommended local design:

- Allow an optional output schema in an agent definition and/or `Agent action=run`.
- Inject a terminating schema-backed tool.
- Store both the human summary and validated structured payload.
- Fail clearly if a schema was required but the child never supplied it.

High-value initial schemas:

- Reviewer findings with severity, path, line, evidence, and fix
- Oracle verdict with risks and recommendation
- Search result with symbols, paths, and relationships
- Librarian result with source URLs, commit, and confirmed/inferred claims

### 6. Distinguish delivered results from consumed results

Upstream defers automatic background result delivery and lets an explicit wait consume the pending result, preventing duplicate parent-context injection: `extensions/subagents/src/result-delivery.ts:1-19` and `extensions/subagents/index.ts:186-208,339-355`.

The local notification lease system already prevents duplicate notification delivery, but `Agent action=result` does not clearly mark a pending completion notification as consumed: `common/.pi/agent/extensions/subagents/notifications.ts:81-145` and `runtime.ts:230-258`.

Recommended distinction:

- Durable job history remains forever subject to pruning policy.
- Context delivery is independently marked pending, delivering, delivered, consumed, or obsolete.
- A blocking run or explicit full result retrieval should consume/obsolete pending completion injection.
- Fetching a status preview should not consume the final result.

### 7. Add a native dashboard over the existing durable store

Upstream maintains normalized transcript entries, live tools, usage, queued messages, and status in `extensions/subagents/src/domain.ts:73-208` and folds activity in `extensions/subagents/src/manager.ts:287-361`.

Its `/subagents` command opens a full-screen dashboard and takeover view: `extensions/subagents/src/ui/takeover.ts:52-85`. The takeover view supports live transcript rendering, aborting, scrolling, and sending follow-up input: `takeover.ts:350-475`.

The local `/agents` command primarily emits text notifications (`common/.pi/agent/extensions/subagents/index.ts:48-105`), while Herdr provides the real interactive terminal.

Recommended local dashboard fields:

- Agent name, job ID, and backend
- State and current activity
- Model, effort, elapsed time, and context usage
- Recent tool calls and failures
- Pending permission requests
- Worktree state and apply/retain/discard controls
- Herdr tab/pane metadata and focus/close actions

Do not duplicate Herdr's terminal takeover. The dashboard should be a durable cross-backend control plane; focusing Herdr remains the deep interactive view.

### 8. Keep workflows separate from ordinary delegation

Upstream correctly treats a single subagent and a multi-agent workflow as different abstractions. Workflow runs have a global concurrency cap of four and a maximum of 32 child calls: `extensions/workflows/controller.ts:1-3,77-183`.

The local prompt forbids nested delegation unless the user explicitly requests a workflow, but no workflow primitive exists: `common/.pi/agent/extensions/subagents/runtime.ts:199-207`.

Recommended approach:

- Do not enable recursive `Agent` access in normal children.
- Add a separate, explicitly invoked workflow tool.
- Prefer a declarative workflow format first.
- If accepting model-authored JavaScript, run it in a permission-restricted subprocess with bounded IPC, source/result limits, cancellation, and a fixed child-call budget.
- Preserve phased progress and per-child structured artifacts.

A minimal useful workflow supports:

1. Declare phases.
2. Run independent children in parallel with bounded concurrency.
3. Check each child's success explicitly.
4. Pass validated structured results into a synthesis child.
5. Return one bounded aggregate.

## Local capabilities that are already better

### Specialized, policy-bearing agent definitions

Local Markdown definitions support:

- Agent name and description
- Model and thinking level
- Tool allowlists and denylists
- Edit/write/bash permissions
- Compaction settings
- Turn limits
- Background policy
- Return-mode hints
- Built-in, user, and project scopes

Implementation: `common/.pi/agent/extensions/subagents/agents.ts:24-40,187-230`.

Example: `common/.pi/agent/extensions/subagents/agents/librarian.md`.

Preserve this role system. It is more reusable and governable than passing every policy choice with an arbitrary prompt.

### Worktree-isolated mutation

Write-capable local agents receive isolated Git worktrees and require explicit apply, retain, or discard actions. Initialization occurs in `common/.pi/agent/extensions/subagents/runtime.ts:273-292`; tests are in `subagents/test/worktree.test.ts`.

Preserve this. It is safer than allowing concurrent children to mutate the parent checkout.

### Durable Herdr execution and control

The local system supports:

- Observable interactive child terminals
- Durable job state across parent lifecycle boundaries
- Child messaging and resumption
- Permission forwarding
- Session ownership checks
- Atomic private state files
- Locking and stale-lock handling
- Leased, idempotent notifications
- Focus, close, cancel, cleanup, apply, retain, and discard controls

Key files:

- `common/.pi/agent/extensions/subagents/herdr-runtime.ts`
- `common/.pi/agent/extensions/subagents/job-types.ts:75-127`
- `common/.pi/agent/extensions/subagents/job-store.ts:44-147,190-227`
- `common/.pi/agent/extensions/subagents/notifications.ts`

Upstream standalone subagents are predominantly session-scoped and are disposed on session shutdown. The local Herdr design should remain the foundation for durable work.

### Project-agent trust and scoped discovery

Local definitions can come from built-in, user, or project directories, with precedence and explicit project-agent confirmation. See `common/.pi/agent/extensions/subagents/agents.ts:187-230` and `runtime.ts:169-172,261-265`.

Preserve the trust confirmation. Repository-controlled agent prompts are executable policy and should not silently override global definitions.

## Recommended implementation sequence

### Phase 1 — Governance

1. Package `subagents` as a normal workspace.
2. Run its tests and typecheck from root scripts.
3. Add the global semaphore and race-condition tests.

### Phase 2 — Runtime resilience

1. Add per-tool timeouts.
2. Add first-response watchdogs.
3. Correct child extension binding and shutdown.
4. Add cancellation and teardown race tests.

### Phase 3 — Composability

1. Add structured output schemas.
2. Separate job history from result-delivery state.
3. Normalize more transcript/activity data across in-process and Herdr backends.

### Phase 4 — Operator experience and orchestration

1. Add a durable dashboard.
2. Add a separate workflow primitive.
3. Keep recursive child delegation disabled.

## Important design invariants for future agents

- Never allow normal child agents to recursively spawn more agents merely to simulate workflows.
- Concurrency capacity must be reserved before asynchronous launch work.
- Every launch path must release capacity exactly once.
- Cancellation must retain partial diagnostics and durable state.
- Explicit result retrieval must not cause duplicate synthetic completion turns.
- Write-capable parallel work remains isolated until the parent explicitly applies it.
- Project-local agent definitions remain trust-gated.
- Child extension shutdown must be bounded and idempotent.
- Model-authored orchestration code must never execute unsandboxed in the parent process.

## Current agent-model behavior

The local `Agent` tool does not currently accept per-invocation model or effort overrides. Its schema is in `common/.pi/agent/extensions/subagents/runtime.ts:28-39`. Model and thinking are read from the selected Markdown agent definition and applied by both runtimes.

A dedicated copy of the reviewer has now been added for Fable 5 at high effort:

- `common/.pi/agent/extensions/subagents/agents/fable-reviewer.md`
- Name: `fable-reviewer`
- Model: `anthropic/claude-fable-5`
- Thinking: `high`

Invoke it with `Agent agent=fable-reviewer` after reloading Pi.
