# Pi workflows

Task-level orchestration for Pi. A workflow is a sandboxed JavaScript program that coordinates isolated child agents through explicit phases and values.

This extension deliberately does **not** implement agent teams, peer mailboxes, shared mutable task boards, or direct child-to-child messaging. Cross-checking is expressed by passing one child's structured result to another child in the script.

## Model-facing tool

```js
export const meta = {
  name: "review-and-verify",
  description: "Review changed files, then verify the findings",
  phases: [{ title: "Review" }, { title: "Verify" }],
}

const reviews = await phase("Review", () => parallel(args.files.map(file => () =>
  agent(`Review ${file}`, { label: file, schema: args.schema })
)))

const verified = await phase("Verify", () => agent(
  `Verify: ${JSON.stringify(reviews)}`,
  { label: "verifier", schema: args.verificationSchema },
))

return { reviews, verified }
```

Available globals: `args`, `phase(title[, callback])`, `agent(prompt, { label?, phase?, schema?, model?, effort? })`, and `parallel(items, { concurrency })`. Parallel items may be agent promises or zero-argument functions; use functions when requesting a lower `concurrency` limit. Workflow children always use the dedicated ephemeral `workflow-worker`; named standalone subagent types are intentionally unavailable. Children default to `openai-codex/gpt-5.6-sol`; the only model override is `anthropic/claude-fable-5` (shorthands: `gpt-5.6-sol` and `fable-5`).

Every `agent()` resolves to `{ ok, output, structured?, error? }`; scripts must inspect `ok`. Workflow children are in-process and dashboard-backed by default, avoiding one Herdr tab per child.

## Safety and limits

- generated scripts require explicit approval in UI modes;
- orchestration runs in a permission-restricted Node child with narrow authenticated IPC;
- no imports, filesystem, network, process, timers, eval, dynamic code generation, or WebAssembly;
- 32 agent calls per run and four globally concurrent agent operations across workflows and standalone subagents;
- 45-second first-response watchdog and three-minute child tool timeout;
- bounded source, arguments, IPC messages, transcripts, and result artifacts;
- unawaited child calls fail the workflow.

## Commands

- `/workflows` — floating phase/agent dashboard with transcript inspection, cancel, restart, and Markdown report export;
- `/activity` — unified attention view over subagents and workflow runs.

Workflow state and one-off run artifacts live under `${XDG_STATE_HOME:-~/.local/state}/pi/workflows/`. Press `s` in a run detail view to export `report.md` beside the run artifacts.

Pi intentionally has no built-in background bash runtime, and this repository has no separate durable background-session supervisor. The unified activity model retains `shell` and `session` as future adapter kinds without fabricating unsupported lifecycle semantics.
