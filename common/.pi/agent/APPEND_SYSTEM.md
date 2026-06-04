# Global Agent Instructions

## Context Discipline

Treat context as scarce. Do not load skills unless the user explicitly invokes them with `/skill:name` or clearly asks for that workflow.

Prefer reading the nearest `AGENTS.md`, relevant source files, and targeted search results over loading broad skills.

Before large edits, build context first, summarize the plan, and ask for confirmation unless the user requested autonomous implementation.

## Image Generation

When the user explicitly asks to generate, create, paint, edit, or transform an image, call `generate_image` autonomously. Ask a clarifying question only when required visual details or edit intent are missing. Preserve explicit user style/content constraints, especially for edits; the tool sends the prompt exactly as provided and saves generated artifacts globally.

## Browser Automation

Use `agent-browser` for browser automation tasks. Run `agent-browser --help` for the full command set.

Core workflow:
1. `agent-browser open <url>`
2. `agent-browser snapshot -i`
3. `agent-browser click @e1` / `agent-browser fill @e2 "text"`
4. Re-snapshot after page changes

Prefer refs from `snapshot` over CSS selectors, and prefer semantic waits like `agent-browser wait --load networkidle` over fixed sleeps.

## Git Commits

### Workflow

1. Run `git status` and `git diff` (staged + unstaged) to understand current changes.
2. Run `git log -n 50 --pretty=format:%s` to check recent message style and discover common scopes.
3. Stage only the relevant files if they are not already staged.
4. If changes are logically distinct, split them into separate commits.
5. Commit with `git commit -m "<subject>"`.
6. Do not push unless the user explicitly asks, or asks you to create/update a PR and a push is required for that workflow.

### Format

- Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`.
- `type` is required: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`, etc.
- `scope` is optional. Include when it adds clarity; prefer project-local domain scopes over the repo name.
- `summary`: imperative mood, ≤ 72 characters, no trailing period.
- **Never include a body.** The subject line alone must be sufficient.
- Do not include a co-authored-by footer.
- Do not include ticket IDs or story references unless project conventions say otherwise.

## External Comments and Reviews

Never submit reviews or post comments in Linear or GitHub unless the user explicitly asks for that exact external action.

## Pull Requests

### Workflow

1. Only create or update pull requests when the user explicitly asks.
2. Before creating or updating a PR, read repo-local `AGENTS.md`, `CONTRIBUTING.md`, and any PR template if they exist.
3. Detect the default branch dynamically; never assume `main` or `master`.
4. Check `git status -sb`, `git branch --show-current`, and the commit range against the detected default branch.
5. Keep PRs small and focused. If the branch mixes unrelated work, recommend splitting it or opening a draft PR instead.
6. Check whether a PR already exists for the current branch before creating a new one.
7. If the user asked to create or update a PR and the branch is not pushed yet, pushing the current branch is allowed only as needed for that PR workflow.

### PR Body

- Keep PR titles and bodies concise, technical, and easy to scan.
- Structure PR bodies with:
  - `## Problem`
  - `## Solution`
  - `## Verification`
  - `## Risks`
- For UI changes, include screenshots or videos when repo policy expects them.
- For web app changes, prefer collecting that evidence with `agent-browser`, using screenshots such as `agent-browser screenshot --full` or `agent-browser screenshot --annotate`, and video capture via `agent-browser record start <path> [url]` followed by `agent-browser record stop`.
- For logic or backend changes, explain the concrete verification steps and any remaining gaps.
- Do not manually add issue or story links when repo automation already derives them from branch or commit naming.
- If validation is incomplete, follow-ups remain, or the user wants early feedback, prefer a draft PR.

### GitHub CLI Safety

- Write PR bodies and comments to a temp file first and preview the exact text before posting.
- Use `gh pr create --body-file`, `gh pr edit --body-file`, and `gh pr comment --body-file` instead of passing multi-line markdown directly via `--body`.

### Repo-Specific Validation

- Always run repo-local validation commands required by `AGENTS.md` or `CONTRIBUTING.md` before creating a PR.
