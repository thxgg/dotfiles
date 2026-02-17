---
name: worktree
description: Create a git worktree from a Shortcut story ID. Use when starting work; no ID creates a scratch worktree.
---

# Git Worktree from Shortcut Story

Create a linked git worktree using the branch name associated with a Shortcut story.

If no story ID is provided, create a scratch worktree with a short random suffix.

## Instructions

1. **Parse input** from `$ARGUMENTS`
   - **Story mode:** If a story ID is provided, it should be numeric (e.g., `12345`). If the user pasted a Shortcut URL, extract the first numeric ID.
   - **Scratch mode:** If no argument is provided, do not call Shortcut. Generate a short random suffix (8 hex chars recommended) and use it to name both the branch and the destination folder.
     - Recommended suffix command: `uuidgen | cut -d- -f1 | tr '[:upper:]' '[:lower:]'`
     - Example branch name: `wt/<suffix>`
     - Example destination folder suffix: `wt-<suffix>`

2. **Resolve branch name**
   - **Story mode:** Call `mcp__shortcut__stories-get-branch-name` with the story ID.
     - If the story has no branch linked, ask the user for the branch name to use (recommended default: `sc-<story-id>`).
   - **Scratch mode:** Use the generated branch name from step 1.

3. **Determine repo root and destination path**
   - Find the current git repository root: `git rev-parse --show-toplevel`
   - Repo name is the basename of the repo root.
   - The worktree is created as a sibling of the repo root directory:
     - Story mode: `../<repo-name>-<story-id>`
     - Scratch mode: `../<repo-name>-wt-<suffix>`
   - Important: compute the destination path relative to the repo root (not the current subdirectory) so it works from anywhere inside the repo.

4. **Preflight checks**
   - If `git rev-parse --show-toplevel` fails, you are not inside a git repo. Ask the user to run `/worktree` from within the target repo.
   - If the destination path already exists on disk, do not overwrite it. Inform the user and stop.
   - If the destination path is already registered as a worktree (even if the folder is missing):
     - Run `git worktree list --porcelain`
     - If any entry has `worktree <dest-path>`, report it and stop (suggest `git worktree remove <dest-path>` if it is stale).
   - Refresh refs so branch resolution is accurate: `git fetch --all --prune`
   - If the target branch is already checked out in another worktree:
     - Run `git worktree list --porcelain`
     - If any entry has `branch refs/heads/<branch-name>`, report the existing worktree path and stop.
     - Do not use `--force` automatically.

5. **Create the git worktree (correct syntax + branch resolution)**
   - **Scratch mode:** always create a new local branch:
     - `git worktree add -b <branch-name> <dest-path>`
   - **Story mode:** prefer existing local/remote branch if present.
     - First try: `git worktree add <dest-path> <branch-name>`
       - Uses local branch if it exists.
       - If it does not exist locally but exists in exactly one remote, git will create a local tracking branch automatically.
     - If that fails because the branch does not exist anywhere, create a new local branch from `HEAD`:
       - `git worktree add -b <branch-name> <dest-path>`

6. **Report the result**
   - On success: report the new worktree path and branch name.
   - On failure: report the error and suggest next actions.

## Error Handling

- If the story ID is invalid or not found, report the error.
- If a worktree already exists at the destination path, inform the user.
- If the branch is already checked out in another worktree, report where.
- If the remote branch name is ambiguous (exists in multiple remotes), report the ambiguity and ask the user which remote to use.

## Example

```
User: /worktree 12345

-> Fetches branch name from Shortcut story 12345
-> Creates worktree at ../my-repo-12345 with the fetched branch
-> Reports: "Created worktree at /path/to/my-repo-12345 with branch feature/sc-12345-story-title"
```

Scratch mode:

```
User: /worktree

-> Generates suffix like "a1b2c3d4"
-> Creates branch wt/a1b2c3d4 and worktree at ../my-repo-wt-a1b2c3d4
```
