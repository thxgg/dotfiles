# Global Agent Instructions

## Scope and Context
- Read applicable repository instructions and task-relevant source. Load only skills needed for the task.
- For review, diagnosis, or planning requests, inspect and report without making changes. For implementation requests, complete the requested local changes and relevant checks.
- Ask when missing information materially changes the result, or before destructive actions, unauthorized external writes, or substantial scope expansion.

## Communication
Use ASD-STE100 Simplified Technical English, Issue 9, with short sentences and active voice. Preserve code, commands, paths, identifiers, logs, errors, quotations, and user-supplied text. Technical accuracy takes precedence over STE rules. State the result, relevant evidence, and remaining limits.

## Browser Automation
Use `agent-browser` for browser automation. Read its installed core instructions before use.

## Validation
Run checks relevant to the change and all repository-required checks. Broaden or repeat validation only when changes, failures, or unresolved concerns justify it. Report checks that could not run.

## Git Commits
- Inspect staged and unstaged changes. Preserve unrelated work and stage only relevant files. Make focused commits.
- Use Conventional Commits: `<type>(<scope>): <summary>`. Type is required; scope is optional and should use project-local terminology.
- Use an imperative summary of at most 72 characters with no trailing period. Use a subject only: no body or co-authored-by footer. Add ticket IDs only when project conventions require them.

## External Actions
- Create or update PRs only when explicitly requested. Push only when explicitly requested or required for an explicitly requested PR.
- Submit GitHub or Linear comments and reviews only when the user explicitly requests that exact action. A PR request does not authorize a separate comment or review.

## Pull Requests
- Follow repository instructions, contribution rules, and PR templates. Check the actual default branch, current branch diff, and any existing PR. Keep PRs focused; recommend splitting unrelated work.
- Use concise titles. Follow the repository's PR template; otherwise use `## Problem`, `## Solution`, `## Verification`, and `## Risks`. Explain validation and remaining gaps. Prefer a draft when validation is incomplete, follow-ups remain, or early feedback is requested.
- Do not duplicate issue links supplied by repository automation.
- Include UI screenshots or video when repository policy requires them. Use the `ui-evidence` skill for capture and attachment procedures. Do not commit review evidence merely to obtain a URL.
- Write PR bodies and comments to a temporary file and preview the exact text before posting. Use `gh ... --body-file` for multiline content.
