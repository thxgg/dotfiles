# Pi subagents

One isolated unit of work or specialized capability, delegated through the model-facing `Agent` tool.

Use a subagent for context preservation (exploration, call-site lookup, repository inspection, focused review) or a distinct tool/model policy (Painter, Librarian, Oracle). Use the separate `workflow` tool when the main task needs structured multi-agent fan-out, phases, cross-checking, and synthesis.

## Interfaces

- `Agent` — run/list/result/control tool used by the model;
- `/agents` — attention-grouped dashboard; inspect jobs and focus/cancel/approve/deny/apply/retain/discard;
- Herdr child — deep interactive view for deliberate standalone jobs;
- `${XDG_STATE_HOME:-~/.local/state}/pi/subagents/` — durable job state.

The extension was originally inspired by Amp's subagent concepts, but its identity and architecture are now Pi-specific. Completed Herdr children remain inspectable until explicitly closed or cleaned up.
