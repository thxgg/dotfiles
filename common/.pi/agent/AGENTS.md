# Global Agent Instructions

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
5. Commit with `git commit -m "<subject>"` (and `-m "<body>"` if a body is needed).
6. Do not push.

### Format

- Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`.
- `type` is required: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`, etc.
- `scope` is optional. Include when it adds clarity; prefer project-local domain scopes over the repo name.
- `summary`: imperative mood, ≤ 72 characters, no trailing period.
- **Almost never include a body.** The subject line alone should be sufficient for the vast majority of commits. Only add a body when the change is truly niche — i.e., the *reason* behind it would not be understandable from the subject alone. When in doubt, omit the body.
- Do not include a co-authored-by footer.
- Do not include ticket IDs or story references unless project conventions say otherwise.
