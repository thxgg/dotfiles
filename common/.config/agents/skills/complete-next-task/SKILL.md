---
name: complete-next-task
description: Complete the next incomplete task from a PRD
---

# Complete Next Task from PRD

Complete one task from a PRD file. Implements the next task with `passes: false`, runs feedback loops, commits, and captures commit SHAs for traceability.

## Usage

```
/complete-next-task <prd-name>
```

Where `<prd-name>` matches `.agents/state/<prd-name>/prd.json` (or `.claude/state/<prd-name>/prd.json`)

## File Discovery

Search for the state directory starting from cwd and walking up:

1. Check if `.agents/state/<prd-name>/prd.json` or `.claude/state/<prd-name>/prd.json` exists at current level
2. If not found, go up one directory
3. Repeat until found or reaching filesystem root

State directory structure:
```
<state-dir>/
├── prd.json       # Task list with passes field
└── progress.json  # Cross-iteration memory (patterns, task logs)
```

## Process

### 1. Get Bearings

- Read progress.json - **CHECK 'patterns' ARRAY FIRST**
- Read prd.json - find next task with `passes: false`
  - **Task Priority** (highest to lowest):
    1. Architecture/core abstractions
    2. Integration points
    3. Spikes/unknowns
    4. Standard features
    5. Polish/cleanup
- Check recent git history: `git log --oneline -10`

### 2. Initialize Progress (if needed)

If progress.json doesn't exist, create it.

**Get current UTC timestamp using bash:**
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

```json
{
  "prdName": "<prdName from PRD>",
  "started": "<UTC timestamp from bash>",
  "patterns": [],
  "taskLogs": []
}
```

### 3. Mark Task as In Progress

Before starting work, update both files to track the task pickup:

**Get current UTC timestamp:**
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

**In prd.json:** Set the task's `status` field to `"in_progress"`:
```json
{
  "id": "task-1",
  "status": "in_progress",
  "startedAt": "<UTC timestamp from bash>",
  "passes": false
}
```

**In progress.json:** Add an entry to `taskLogs` with `status: "in_progress"`:
```json
{
  "taskId": "<task.id>",
  "status": "in_progress",
  "startedAt": "<UTC timestamp from bash>"
}
```

### 4. Branch Setup

Extract `prdName` from PRD, then:
- `git checkout -b <prdName>` (or checkout existing branch)

### 5. Implement Task

Work on the single task until verification steps pass.

### 6. Feedback Loops (REQUIRED)

Before committing, run ALL applicable:
- Type checking (tsc, mypy, etc.)
- Tests (jest, pytest, cargo test, etc.)
- Linting (eslint, ruff, clippy, etc.)
- Formatting (prettier, black, rustfmt, etc.)

**Do NOT commit if any fail.** Fix issues first.

### 7. Update PRD

**Get current UTC timestamp:**
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Update the task in prd.json:
- Set `passes` to `true`
- Set `status` to `"completed"`
- Set `completedAt` to the UTC timestamp

### 8. Update Progress

**Get current UTC timestamp:**
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Find the existing `taskLogs` entry (created in step 3) and update it:

```json
{
  "taskId": "<task.id>",
  "status": "completed",
  "startedAt": "<original startedAt value>",
  "completedAt": "<UTC timestamp from bash>",
  "implemented": "<what was implemented>",
  "filesChanged": ["<file1>", "<file2>"],
  "learnings": "<patterns, gotchas discovered>",
  "commits": []
}
```

Note: The `commits` array will be populated after step 9 (Commit) - see step 10.

If you discover a **reusable pattern**, also add to the `patterns` array.

### 9. Commit

1. Run `git status` to see staged and unstaged changes
2. Run `git diff --cached` to see what will be committed (if files are staged)
3. Run `git diff` to see unstaged changes (if nothing is staged yet)
4. Stage relevant files (avoid `git add -A` to prevent staging unrelated changes)
5. Analyze changes to determine if they should be split into separate commits:
   - If changes are logically distinct (e.g., a bug fix AND a new feature), split them
   - Each commit should represent a single logical change
6. Create a concise one-line commit message following conventional commits format (feat, fix, chore, docs, refactor, test)
7. Commit with: `git commit -m "message"` (no co-authored-by footer)

### 10. Capture Commit SHAs

After committing, capture the SHA(s) of commits made for this task:

```bash
git rev-parse HEAD
```

Update the `commits` array in the taskLog entry in progress.json. Only add the feat/fix/refactor commits for the task implementation, not the chore commit for updating task status.

## Completion

If all tasks have `passes: true`, output:

```
<tasks>COMPLETE</tasks>
```

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden. Patterns you establish will be copied. Corners you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.

<user-request>
$ARGUMENTS
</user-request>
