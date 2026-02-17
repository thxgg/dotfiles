---
description: Review changes with parallel @review subagents
agent: build
---

Review uncommitted changes by default. If there are no uncommitted changes, review the latest commit.

Guidance: $ARGUMENTS

Launch THREE (3) `@review` subagents in parallel with distinct focus areas.

Default focus areas:
1. correctness and regressions
2. security and resilience
3. complexity and maintainability

If the user provided specific review focus areas, use those instead.

After all reviewers return:
- deduplicate overlapping findings and keep the version with the strongest evidence
- if findings disagree on severity, keep the higher severity
- drop any finding without both `file:line` and a concrete scenario
- run project lint/type/test commands to validate or discover missed issues

Then launch ONE (1) final `@review` subagent with the compiled findings and this instruction:

"For each finding, verify the referenced `file:line` in current code and classify it as Confirmed, Disputed, or Acknowledged. Return Confirmed findings only."

Return only Confirmed findings, ordered by severity. If none are confirmed, say so clearly.
