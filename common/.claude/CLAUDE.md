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
