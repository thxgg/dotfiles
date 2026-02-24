---
name: commit-release
description: Commit pending changes and run an npm+GitHub release workflow safely. Use when publishing a new version.
---

# Commit and Release

Commit current work, then perform a release with a strict order of operations.

## Usage

```text
/commit-release
/commit-release patch
/commit-release 1.4.2
```

- If `$ARGUMENTS` is a full semver (`x.y.z`), release exactly that version.
- If `$ARGUMENTS` is `patch|minor|major`, use that bump type.
- Base behavior when no argument is provided: bump current version to `x.y.(z+1)` (patch increment).

## Instructions

1. Inspect repository state:
   - `git status`
   - `git diff`
   - `git log --oneline -10`

2. Commit non-release changes first:
   - Stage only relevant files.
   - Split logically distinct changes into separate commits.
   - Use one-line conventional commit messages.

3. Ensure release preconditions:
   - Confirm clean tree on the target release branch (usually `main`).
   - Confirm branch is synced with remote before bumping version.
   - Check current published version with `npm view <package-name> version`.

4. Determine target release version from `$ARGUMENTS`:
    - explicit `x.y.z` -> use as-is.
    - bump keyword -> resolve via `npm version <keyword> --no-git-tag-version`.
    - no argument -> read current package version and increment patch (`x.y.z` -> `x.y.(z+1)`) via `npm version patch --no-git-tag-version`.
    - Ensure target version does not already exist on npm.

5. Execute release in this exact order:
   - `git status`
   - `npm version <resolved-version-or-bump> --no-git-tag-version`
   - `npm run typecheck`
   - `git commit -am "chore(release): bump v<version>"`
   - `git push origin main`
   - `git tag -a v<version> -m "v<version>"`
   - `git push origin v<version>`
   - `gh release create v<version> --title "v<version>" --generate-notes`
   - `gh run list --workflow Publish --limit 5`
   - `npm view <package-name> version`

6. Return:
   - Commit SHA(s) created before release.
   - Release commit SHA.
   - Tag name.
   - GitHub release URL.
   - Publish workflow status and final npm version.

## Safety Rules

- Never use force push or destructive git resets.
- Do not amend unless explicitly requested.
- Do not create empty commits.
