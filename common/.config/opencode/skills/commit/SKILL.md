---
name: commit
description: Create one-line commits without co-authored-by
---

# Commit

Create a git commit with a one-line message, without the co-authored-by footer.

## Usage

```
/commit
/commit fix typo in readme
```

If `$ARGUMENTS` is provided, use it as guidance for the commit message.

## Instructions

1. Run `git status` to see staged and unstaged changes
2. Run `git diff --cached` to see what will be committed (if files are staged)
3. Run `git diff` to see unstaged changes (if nothing is staged yet)
4. If no files are staged, ask the user which files to stage or stage all relevant changes
5. Analyze the changes to determine if they should be split into separate commits:
   - If changes are logically distinct (e.g., a bug fix AND a new feature, or changes to unrelated modules), split them into separate commits
   - Each commit should represent a single logical change
   - Stage and commit each logical group separately
6. Create a concise one-line commit message that:
    - Follows conventional commits format with a required scope: `<type>(<scope>): <summary>`
    - Uses a project-local domain scope (NOT monorepo/project-name scope)
    - Derives scope from the primary feature/module touched in the current project
    - Uses this soft allowlist by convention:
      - backend: `auth`, `promocodes`, `offers`, `notifications`, `database`, `payments`, `members`, `subscriptions`, `deps`, `ci`
      - cms: `auth`, `member`, `offers`, `admin-users`, `totp`, `deps`, `ci`
      - cms-vue: `auth`, `offers`, `notifications`, `members`, `deps`, `ci`
    - If no allowlist scope fits, choose a short, specific domain scope; do not omit scope
    - Summarizes the changes clearly
    - Is under 72 characters if possible
7. Commit with: `git commit -m "message"`

Do NOT include a co-authored-by footer.
