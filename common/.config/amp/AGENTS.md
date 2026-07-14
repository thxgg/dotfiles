# Global Agent Instructions

## Context Discipline

Treat context as scarce. Load a skill only when the user explicitly requests it or the task clearly matches its description.
Prefer reading the nearest `AGENTS.md`, relevant source files, and targeted search results over loading broad skills.
Before large edits, build context first, summarize the plan, and ask for confirmation unless the user requested autonomous implementation.

## Image Generation

When the user explicitly asks to generate, create, paint, edit, or transform an image, use Amp's Painter autonomously. Ask a clarifying question only when required visual details or edit intent are missing. Preserve explicit style and content constraints, especially for edits.

## Browser Automation

Use `agent-browser` for browser automation. Before automating, load the installed core instructions with `agent-browser skills get core`; add `--full` when references and templates are needed. Use `agent-browser skills list` and `agent-browser skills get <name>` to discover task-specific instructions. Prefer these current bundled instructions over cached copies. Run `agent-browser --help` for the full command set.

Core workflow:

1. `agent-browser open <url>`
2. `agent-browser snapshot -i`
3. `agent-browser click @e1` or `agent-browser fill @e2 "text"`
4. Re-snapshot after page changes

Prefer refs from `snapshot` over CSS selectors, and semantic waits such as `agent-browser wait --load networkidle` over fixed sleeps.

## Git Commits

### Workflow

1. Run `git status` and both staged and unstaged `git diff` to understand current changes.
2. Run `git log -n 50 --pretty=format:%s` to check recent message style and common scopes.
3. Stage only relevant files that are not already staged.
4. Split logically distinct changes into separate commits.
5. Commit with `git commit -m "<subject>"`.
6. Do not push unless the user explicitly asks, or asks to create or update a pull request and a push is required.

### Format

- Use Conventional Commits: `<type>(<scope>): <summary>`.
- `type` is required: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`, or another established project type.
- Include a scope when it adds clarity; prefer project-local domain scopes over the repository name.
- Use imperative mood, at most 72 characters, with no trailing period.
- Never include a commit body.
- Do not include a co-author footer.
- Do not include ticket IDs unless repository conventions require them.

## External Comments and Reviews

Never submit reviews or post comments in Linear or GitHub unless the user explicitly asks for that exact external action.

## Pull Requests

### Workflow

1. Create or update pull requests only when the user explicitly asks.
2. Read repository-local `AGENTS.md`, `CONTRIBUTING.md`, and any pull-request template first.
3. Detect the default branch dynamically; never assume `main` or `master`.
4. Check `git status -sb`, the current branch, and the commit range against the detected default branch.
5. Keep pull requests small and focused. Recommend splitting mixed work or opening a draft when appropriate.
6. Check whether a pull request already exists for the current branch before creating one.
7. If the requested pull-request workflow requires a push, pushing the current branch is allowed.

### Body

Use these sections:

- `## Problem`
- `## Solution`
- `## Verification`
- `## Risks`

For web UI changes, include screenshots or recordings when repository policy expects them; use the `ui-evidence` skill when applicable. For logic or backend changes, give concrete verification and remaining gaps. Do not manually add issue links when repository automation derives them from branch or commit naming. Prefer a draft when validation is incomplete or early feedback is requested.

### GitHub CLI Safety

Write pull-request bodies and comments to a temporary file and preview the exact text before posting. Use `gh pr create --body-file`, `gh pr edit --body-file`, and `gh pr comment --body-file` rather than inline multiline bodies.

### Repository Validation

Always run validation required by repository-local `AGENTS.md` or `CONTRIBUTING.md` before creating a pull request.
