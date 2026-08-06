# Pi subagents

One isolated unit of work or specialized capability, delegated through the model-facing `Agent` tool.

Use a subagent for context preservation (exploration, call-site lookup, repository inspection, focused review) or a distinct tool/model policy (Painter, Librarian, Oracle). Use the separate `workflow` tool when the main task needs structured multi-agent fan-out, phases, cross-checking, and synthesis.

## Interfaces

- `Agent` — run/list/result/control tool used by the model;
- `/agents` — attention-grouped dashboard; inspect jobs and open/cancel/approve/deny/apply/retain/discard;
- persistent Pi session — full transcript that opens in a new Herdr pane with `o` from the dashboard list or detail view, or with `/agents open <jobId>`; an existing pane for the exact session is focused instead of duplicated, and exiting Pi closes its on-demand pane;
- `${XDG_STATE_HOME:-~/.local/state}/pi/subagents/` — durable job state.

The extension was originally inspired by Amp's subagent concepts, but its identity and architecture are now Pi-specific. It does not create Herdr tabs or panes. Each child uses a normal persistent Pi session, while its execution stays isolated from the parent conversation.
