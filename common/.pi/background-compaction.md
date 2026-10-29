# Background compaction

`agent/extensions/zz-background-compaction.ts` prepares a summary while the foreground
session continues. It uses the Pi 1.4 public extension API. It does not patch Pi,
replace a provider, start a child agent, or edit settings files.

## Operation

The extension starts enabled when loaded. Native automatic compaction must also
be enabled. Use these session-local commands:

```text
/bg-compact          Show status
/bg-compact off      Cancel the job and use native compaction only
/bg-compact on       Enable background preparation again
```

Background preparation is silent: no automatic TUI/RPC status updates or
notifications, and no summary deltas in the conversation. `/bg-compact` reports
status only when requested. Pi’s native compaction display remains unchanged.

1. After a completed turn, check Pi's effective compaction settings. These include
   project trust, SDK overrides, and `compaction.modelOverrides`.
2. Start at 85% of `contextWindow - reserveTokens`, but not if compaction is
   already due. Require at least 64,000 measured input/cache tokens from a
   successful response by the selected model.
3. Summarize the projected conversation before the latest assistant response.
   Keep that response and its tool results together. Include the previous summary
   when preparing a later checkpoint. Context edits are applied before summarizing.
4. Hold the result in memory. Do not change the foreground context yet.
5. When Pi requests **threshold** compaction, return the held summary and the old
   `firstKeptEntryId`. Pi persists a normal compaction entry and retains everything
   from that boundary onward. Original history stays in the session file.

With a 272,000-token window and the default 16,384-token reserve, preparation
starts at about 217,274 tokens. Pi's normal compaction threshold remains 255,616.
Model-specific reserves change both numbers.

## Safeguards

- One job per extension session. Each job has a five-minute deadline. It requests
  at most 8,192 output tokens where the provider accepts a cap. OpenAI ChatGPT
  subscription auth rejects `max_output_tokens`, so that path uses a concise
  summary instruction and the deadline, not an enforced output-token cap.
- If compaction arrives while a usable job runs, wait for that existing job.
  Cancellation and the deadline release the wait even if a provider ignores abort.
- Keep at most `min(max(2 × keepRecentTokens, 30000), 25% of the threshold)`
  estimated tail tokens. Refresh a stale checkpoint on a later eligible turn.
- Check the session, full projected prefix, model, thinking level, effective
  prompt, active tool declarations, and compaction budgets before reuse.
- Reject summaries that do not leave room below the preparation threshold.
- Cancel work on session replacement, tree navigation, fork, model selection,
  compaction, shutdown, or an aborted run. Late results cannot enter another job.
- Empty, partial, aborted, failed, and tool-calling summaries fall back to native
  compaction. Do not retry the same anchor. Stop after two failed jobs until reset.
- Manual `/compact`, custom compaction instructions, and overflow recovery always
  use Pi's native path. Disabling native auto-compaction also stops preparation.

## Differences from OpenCode and remaining limits

This ports **background preparation and delayed application**, not OpenCode's
full compaction pipeline.

- OpenAI `openai-responses` captures the foreground serialized payload, including
  transformed instructions, tool schemas, images, reasoning items, model/tier,
  and prompt-cache key. The summary appends one instruction to the exact input
  prefix. It retains tools but sets `tool_choice: "none"`. It does not enable
  server-side conversation storage. Payloads with server-side history references
  are not reused. A current captured prefix is required on this path.
- Load this extension **after all payload transformers**. The `zz-` filename
  places it after this repository's normal discovered extensions. Explicit
  extension lists must put it last. Pi orders hooks by extension, not by handler
  registration time. A later payload transformer is not reflected in the snapshot.
- Other providers retain Pi's `generateSummaryWithUsage()` serialized-text path,
  with no promise of conversation-cache reuse.
- The same configured model, authentication, and provider wrappers are used.
  OpenAI uses the foreground routing session and cache key. The existing WebSocket
  wrapper already isolates concurrent requests onto separate sockets. Other
  providers use a separate summary routing session. No new credential or billing
  provider is configured. Cache hits remain provider-dependent; matching input
  makes reuse possible but cannot guarantee it.
- Applied summary usage is included in Pi's compaction totals. Discarded or
  interrupted background requests can still be billed by the provider. Pi's public
  extension API has no standalone usage-entry writer, so those requests are **not**
  included in Pi's session totals. Check provider usage for total spend.
- The non-OpenAI serializer shortens tool output and omits thinking blocks.
  OpenAI retains the actual wire input. Summaries remain lossy in both paths.
  Exact file-operation metadata is not accumulated by this extension;
  paths and prior file lists can survive in the summary text.
- The 64k minimum and token estimates are safeguards, not exact tokenizer counts.
  A sudden large result can skip the preparation window. A slow, failed, or stale
  job still causes a compaction pause. This is not a zero-latency guarantee.
- Held summaries are not saved. Reload or restart discards them. Applied summaries
  remain ordinary Pi session entries and need no extension to resume.
- OpenAI captures request-local transformations that precede its payload hook.
  The non-OpenAI path does not replay them, like Pi's native summaries. The
  foreground context is never rewritten by this extension. Avoid combining it
  with another compaction-replacement extension without checking hook order.
- The `background-compaction` event-bus channel reports metadata-only lifecycle,
  timings, usage, prefix hashes, and application estimates. It never emits the
  captured input, headers, summary text, or credentials.

## Research

Inspected OpenCode `dev` at
`d9d3548548b1b7c9f2edd3709864de1eb11c7688`:

- [V2 compaction docs](https://opencode.ai/v2/docs/compaction/): current setting
  `experimental.background_compaction`, threshold, retention, and fallbacks.
- [Original PR #57444](https://github.com/anomalyco/opencode/pull/57444): earlier
  setting `experimental.precompute_compaction`, rationale, and waiting behavior.
- [Source at the inspected commit](https://github.com/anomalyco/opencode/blob/d9d3548548b1b7c9f2edd3709864de1eb11c7688/packages/core/src/session/compaction.ts):
  `precompute`, `usePrecomputed`, `heldIndex`, and `tailLimit`.

The source, not social-media claims, defines the behavior above. A verifiable copy
of the referenced Dax X post was not found.

## Validation and activation

```sh
npm --prefix common/.pi run check
PYTHONDONTWRITEBYTECODE=1 python3 tests/pi-bootstrap.test.py
```

`test/background-compaction.test.mjs` uses real Pi session projection and an
in-memory provider boundary. It also runs a real SDK session through automatic
compaction. The tests make no external model requests. They check preserved tail
messages and tool pairs, repeat compaction, settings, cancellation, deadlines,
failures, stale results, and continuation without another summary request.
The OpenAI serializer/SDK regression also checks exact prefix and tool retention,
cache-key reuse, prior payload transformations, and subscription field limits.

### Manual live probe

`test/live-background-compaction.mjs` is excluded from automatic tests. It requires
an explicit environment opt-in, copies only the selected branch to a private
output directory, uses existing OpenAI authentication without copying credentials,
and disables all tool execution. Its `navigateTree()` calls use the same session
navigation path as `/tree`. Each case starts from the same checkpoint.

```sh
cd common/.pi
PI_LIVE_COMPACTION=1 node --import tsx test/live-background-compaction.mjs \
  /absolute/path/to/source.jsonl CHECKPOINT_ID /private/output/ready ready
```

Cases are `ready`, `inflight`, and `cancel`. Use a different output directory for
each run. `PI_LIVE_MODEL` can select another available OpenAI model. The default
is `gpt-6-astra`. These are paid/allowance-consuming requests. Do not run the probe
on a session with content you do not authorize sending to OpenAI. The output holds
private copied history and a metadata-only `report.json`; do not commit it.
The probe checks the source file hash on completion. It uses native compaction
budgets: the threshold is 255,616 for a 272,000-token model, not the full 272,000.
A follow-up request measures the real post-compaction input size.

### Live results, 29 October 2026

Tested the same personal dotfiles checkpoint (`3f529266`) from an existing
OpenAI session. The original checkpoint reported 240,675 input tokens. Each
case used an independent private copy with OpenAI `gpt-6-astra`, low thinking,
SSE, and a 272,000-token window. Tools were blocked, and the source hash stayed
unchanged. The first uncached foreground call primed each copy's cache.

| Case | Result |
| --- | --- |
| Summary ready first | Summary: 243,840 cache-read + 288 uncached input tokens (99.88% cached), 2,542 output tokens, 88.1 seconds. Threshold compaction at 257,282 tokens. Next measured context: 17,530 tokens (6.44% of window). |
| Threshold while summary runs | Foreground requests continued while summarizing. Summary: 243,840 cache-read + 289 uncached input tokens (99.88% cached), 2,200 output tokens, 79.5 seconds. The threshold handler waited for that same job. Next measured context: 17,188 tokens (6.32%). |
| `/tree`-equivalent navigation | `navigateTree()` returned to the same checkpoint. The pending summary aborted. No background compaction applied. |

The first attempt exceeded the original two-minute deadline. The implementation
now requests a shorter checkpoint and uses a five-minute deadline. These tests
verify actual OpenAI cache accounting, concurrent foreground progress, delayed
application, and post-compaction reduction. They do not prove zero pauses, all
provider/transport combinations, or summary quality for every task. The live
transport was SSE; WebSocket overlap behavior has separate offline coverage.
The `/tree` session API was tested, not the interactive tree selector itself.

Private evidence for this run is under `/tmp/pi-bg-live-ready-2/`,
`/tmp/pi-bg-live-inflight-1/`, and `/tmp/pi-bg-live-cancel-1/`. Each contains a
metadata `report.json` and copied session history. These temporary files may
expire and must not be committed.

For a one-session trial from the repository root:

```sh
pi -e ./common/.pi/agent/extensions/zz-background-compaction.ts
```

For permanent activation, deploy with `./safe-stow.sh --only-pi`, then `/reload`.
Do not also add an explicit `-e` copy after deployment. Implementation and tests do
not deploy files or modify the running session.
