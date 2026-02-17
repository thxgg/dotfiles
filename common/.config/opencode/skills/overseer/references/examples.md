# Examples

## Writing Context

### Good Context Example

```javascript
await tasks.create({
  description: "Migrate storage to one file per task",
  context: `Change storage format for git-friendliness:

Structure:
.overseer/
  tasks/
    task_01ABC.json
    task_02DEF.json

Implementation:
1. Update storage.ts: scan .overseer/tasks/*.json
2. Task file format: Same as current Task schema
3. Migration: On read, if old tasks.json exists, migrate
4. Update tests

Done when: All tests pass, migration works, git diff shows individual task changes`
});
```

### Bad Context Example

```javascript
await tasks.create({
  description: "Add auth",
  context: "Need to add authentication"
});
```

**What's missing:** How to implement it, what files, what's done when, technical approach.

## Writing Results

### Good Result Example

```javascript
await tasks.complete(taskId, {
  result: `Migrated storage from single tasks.json to one file per task:

Implementation:
- Modified Storage.read() to scan .overseer/tasks/ directory
- Auto-migration from old single-file format on first read
- Atomic writes using temp file + rename pattern

Verification:
- All 60 tests passing
- Build successful
- Manually tested migration: old -> new format works`,
  learnings: ["Temp file + rename for atomic writes prevents corruption"]
});
```

### Bad Result Example

```javascript
await tasks.complete(taskId, { result: "Fixed the storage issue" });
```

## Subtask Context Example

```javascript
await tasks.create({
  description: "Add token verification function",
  parentId: jwtTaskId,
  context: `Part of JWT middleware (parent task). This subtask: token verification.

What it does:
- Verify JWT signature and expiration on protected routes
- Extract user ID from token payload
- Return 401 for invalid/expired tokens

Done when:
- Middleware function complete and working
- Unit tests cover valid/invalid/expired scenarios`
});
```
