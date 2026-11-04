---
name: pr-review
description: Give a short PR review and recommend whether it is ready for approval. Use only when the user explicitly invokes pr-review.
disable-model-invocation: true
---

Look into the PR and give me a short and concise review: can we approve it?

Use the supplied PR, or the PR attached to the current thread or branch when unambiguous. Ask which PR only if the target is unclear.

- Review the latest head against its target branch. Read applicable repository instructions, the linked issue or PRD, relevant surrounding code, and existing review discussions.
- Check correctness, regressions, security, and whether the agreed scope and acceptance criteria are met. Verify previous findings against the current code; do not assume passing checks or resolved threads prove correctness.
- Inspect current CI, quality gates, tests, and automated review feedback. Run focused checks when they materially resolve uncertainty. Distinguish checks you ran from results inspected elsewhere, and identify missing validation.
- Lead with **Ready for approval**, **Changes needed**, or **Approval blocked by validation**. Prioritize actionable findings; give each a severity, code location, concrete failure scenario, and required correction. Finish with brief verification and remaining gaps. If there are no blocking findings, say so without inventing issues. Keep the report concise.

This invocation authorizes review and reporting in chat. Do not modify source, commit, push, merge, submit a review or comment, or resolve threads unless the user separately requests that action.
