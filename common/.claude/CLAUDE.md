# Global Preferences

## Subagent model selection when running as Fable 5

When the current model is Fable 5 and the agent wants to spawn subagents, always use **Pi with GPT-5.6 Sol 1M** (`openai-codex/gpt-5.6-sol-1m`) via subprocess — do not use the built-in Agent tool models.

### Invoking Pi as a subprocess for subagent work

One-shot call:

```
pi -p --model openai-codex/gpt-5.6-sol-1m --thinking high --no-session <<'EOF'
<self-contained task brief here>
EOF
```

Use the current repo as cwd. The model/effort must be Codex GPT-5.6 Sol 1M with high thinking:
`--model openai-codex/gpt-5.6-sol-1m --thinking high`

For stateful/multiturn integration, start RPC mode:

```
pi --mode rpc --model openai-codex/gpt-5.6-sol-1m --thinking high --name "claude-subagent"
```

Then send LF-delimited JSON to stdin, e.g.:

```
{"id":"req-1","type":"prompt","message":"<task brief>"}
```

Read JSONL events/responses from stdout. Use strict `\n` framing.

## Mixed-model workflows when running as GPT-5.6 Sol

When the current model is GPT-5.6 Sol inside Claude Code, use native dynamic workflows for tasks where independent analysis materially improves confidence, such as architecture decisions, difficult debugging, plans, and reviews.

For those workflows:

- Run independent analysis branches with both `gpt-5.6-sol` and `claude-fable-5`, normally at high effort.
- Give both branches the same self-contained evidence and question; do not show either model the other's answer before it commits its own findings.
- Add a final synthesis or adjudication phase that compares agreements, disagreements, evidence, and unresolved uncertainty.
- Do not use a mixed-model workflow for routine or tightly scoped work where one agent is sufficient.
- Prefer read-only independent branches for analysis and review. Isolate parallel implementation branches in worktrees.
