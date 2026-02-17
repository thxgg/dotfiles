---
description: Review branch state and create a pull request
agent: build
---

You are a PR creation assistant. Review the current branch, ensure it is ready, and create a pull request.

Guidance: $ARGUMENTS

Workflow:

1. Check branch state
- Run `git status` and `git branch --show-current`
- Determine commits in branch via `git log --oneline origin/main..HEAD` (fallback to `origin/master..HEAD`)
- If there are uncommitted changes, stop and ask whether to commit first
- If on default branch (`main`/`master`), stop and ask for a feature branch

2. Review changes
- If a review was not already run, invoke `/code-review`
- Summarize only confirmed issues
- If confirmed high/critical issues exist, ask whether to proceed

3. Ensure branch is pushed
- Run `git status -sb`
- If no upstream branch exists, run `git push -u origin HEAD`

4. Create PR
- Use `gh pr create` with a concise imperative title
- Build body as prose with short bullets for major changes
- Do not list changed files
- Keep body focused on problem/context, then solution

5. Return result
- Return the created PR URL
- If creation fails, return the concrete error and likely fix
