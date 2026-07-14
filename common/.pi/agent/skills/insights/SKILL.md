---
name: insights
description: Reviews Pi primary or subagent sessions and produces evidence-backed suggestions for improving user prompts, AGENTS.md files, skills, system instructions, tooling, and subagent delegation. Use when the user asks to analyze sessions, recurring agent friction, prompt quality, instruction health, or how the parent agent manages subagents.
---

# Session Insights

Review sessions as a feedback system. Do not treat every bad outcome as an instruction problem.

## Safety and scope

- This workflow is read-only unless the user separately approves specific edits after seeing the report.
- Never quote hidden reasoning. The extractor excludes it.
- Do not expose secrets. Keep extractor redactions intact and further sanitize excerpts when needed.
- Default to primary sessions. Use subagent mode only when requested.
- Default to the current repository's exact CWD and 20 recent sessions. State the actual sample size.
- Record every completed review as a durable run. Reports without provenance cannot support experiments or model-specific comparisons.
- Exclude the current session with `--exclude-session <session-id>` when identifiable; otherwise disclose that it may be present and do not use it as evidence.
- Do not load unrelated project sessions unless the user explicitly asks for cross-project analysis.

## 1. Build the corpus

Resolve this skill directory, then run one of:

```bash
python3 <SKILL_DIR>/scripts/extract_sessions.py \
  --mode primary --cwd "$PWD" --limit 20 \
  --output /tmp/pi-insights-primary.md \
  --manifest /tmp/pi-insights-primary-sessions.json
```

```bash
python3 <SKILL_DIR>/scripts/extract_sessions.py \
  --mode subagents --cwd "$PWD" --limit 20 \
  --output /tmp/pi-insights-subagents.md \
  --manifest /tmp/pi-insights-subagents-sessions.json
```

Primary mode deterministically excludes session files registered as child sessions in `~/.local/state/pi/subagents/*/state.json`.

Subagent mode uses the structured job store, including parent task, child result, status, warnings, usage, and failed tool calls. Analyze two separate concerns:

1. **Delegation quality** — Was the parent's task bounded, self-contained, correctly routed, and explicit about output and permissions?
2. **Management quality** — Did the parent use the result well, avoid redundant children, parallelize independent work, follow up appropriately, and keep ownership of synthesis and verification?

If no sessions are found, report the searched roots and stop. Do not invent findings.

## 2. Read the relevant instruction layers

For findings that might warrant instruction changes, inspect only relevant sources:

1. User prompt or reusable prompt template
2. Nearest applicable `AGENTS.md`, then parents
3. Matching skill's `SKILL.md`
4. Global/system additions such as `~/.pi/agent/APPEND_SYSTEM.md`
5. Tooling or automation that could enforce the behavior instead

Check for existing, duplicated, or conflicting guidance before proposing additions.

## 3. Detect and diagnose

Look for repeated evidence such as:

- User corrections, repeated constraints, reversals, or clarification loops
- Wrong file scope, missed local instructions, premature implementation
- Repeated tool failures, avoidable retries, or poor tool selection
- Missing validation, incomplete outcomes, unsupported certainty
- Excess verbosity or insufficient detail relative to explicit requests
- Instruction duplication, contradictions, or guidance loaded too broadly
- In subagent mode: vague tasks, wrong agent choice, unnecessary serialization, duplicated research, ignored results, weak synthesis, or absent parent verification

Use three relevant sessions as the default threshold for a recurring pattern. A severe one-off may be reported only as low confidence and clearly labeled.

Classify the likely cause before recommending a change:

- prompt ambiguity
- missing or misplaced instruction
- stale documentation
- tooling/automation gap
- agent/model limitation
- isolated event
- insufficient evidence

Include counter-evidence. If successful sessions show the current guidance already works, lower confidence or recommend no change.

## 4. Choose the narrowest effective intervention

Prefer, in order:

1. No change
2. Delete, consolidate, or relocate existing guidance
3. Improve a task prompt/template
4. Update the nearest applicable `AGENTS.md`
5. Update a specialized skill
6. Add tooling or automated validation
7. Update the system prompt only for stable, universal behavior

Do not recommend system-prompt additions for repository facts or occasional workflow preferences.

## 5. Report

Start with scope, sample size, mode, date range, limitations, and the investigator model. Summarize session-model distribution and call out model changes within sessions. Model correlation is evidence, not causation; do not call an issue model-specific without repeated comparative evidence. Then rank at most five findings.

For each finding include:

- **Pattern** and frequency
- **Evidence**: session IDs/dates and short sanitized excerpts
- **Counter-evidence**
- **Diagnosis** and alternatives considered
- **Confidence**: high, medium, or low
- **Target**: exact file/layer, or “no instruction change”
- **Proposed patch**: minimal exact wording or a concise diff
- **Risk**: duplication, contradiction, overfitting, or broader side effects
- **Experiment**: a measurable review window and success criterion

For subagent reports, divide recommendations into `Delegation` and `Management` before any instruction-placement advice.

End with:

- **Do now** — strongest one or two reversible changes
- **Watch** — patterns lacking enough evidence
- **Do not change** — tempting recommendations rejected as overfitting

Do not edit any target file in the same run. Ask the user which proposals, if any, to apply.

## 6. Record the run

Write the final report to a temporary Markdown file, then persist the corpus, exact session manifest, report, investigator model, and investigator session:

```bash
python3 <SKILL_DIR>/scripts/record_run.py \
  --mode <primary|subagents> \
  --corpus /tmp/pi-insights-<mode>.md \
  --manifest /tmp/pi-insights-<mode>-sessions.json \
  --report /tmp/pi-insights-<mode>-report.md \
  --investigator-model '<provider/model>' \
  --investigator-session '<session-id>'
```

The default ledger is machine-local at `~/.local/state/pi/insights/runs/<run-id>/` and contains:

- `corpus.md` — sanitized evidence available to the investigator
- `sessions.json` — exact included session/job IDs, dates, paths, and models
- `report.md` — findings, decisions, and proposed experiments
- `run.json` — run provenance and structured continuation fields

Never overwrite a prior run. When the user accepts/rejects recommendations or updates experiments, append those decisions to `run.json` or create a superseding run; preserve the original report. At the start of later reviews, inspect prior `run.json` and `report.md` files relevant to the same CWD/mode, report experiment progress, and distinguish repeated findings from new ones.
