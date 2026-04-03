---
name: commit
description: Create a one-line conventional commit for the current changes. Use when the user explicitly asks you to commit.
---

Create a git commit with a one-line message and no co-authored-by footer.

Workflow:
1. Inspect `git status`, staged changes, unstaged changes, and recent commit messages.
2. Stage only the relevant files if they are not already staged.
3. Split logically distinct work into separate commits when needed.
4. Draft a concise one-line conventional commit message using `<type>(<scope>): <summary>` when a scope is helpful.
5. Prefer a project-local domain scope rather than the repo name.
6. Omit scope for root-level changes where it would be redundant.
7. Keep the message under 72 characters when practical.
8. Commit with `git commit -m "message"`.

Soft scope conventions used in this codebase family:
- backend: `auth`, `promocodes`, `offers`, `notifications`, `database`, `payments`, `members`, `subscriptions`, `deps`, `ci`
- cms: `auth`, `member`, `offers`, `admin-users`, `totp`, `deps`, `ci`
- cms-vue: `auth`, `offers`, `notifications`, `members`, `deps`, `ci`

If no allowlisted scope fits, choose a short domain scope that matches the primary module touched.

Do not include a co-authored-by footer.
