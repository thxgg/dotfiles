# Global Agent Instructions

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
- Body is optional. If needed, add a blank line after the subject and write short paragraphs.
- Do not include a co-authored-by footer.
- Do not include ticket IDs or story references unless project conventions say otherwise.
