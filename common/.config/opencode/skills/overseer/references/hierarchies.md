# Task Hierarchies

## Three Levels

| Level | Name | Purpose | Example |
|-------|------|---------|---------|
| 0 | **Milestone** | Large initiative (5+ tasks) | "Add user authentication system" |
| 1 | **Task** | Significant work item | "Implement JWT middleware" |
| 2 | **Subtask** | Atomic implementation step | "Add token verification function" |

**Maximum depth is 3 levels.** Attempting to create a child of a subtask will fail.

## When to Use Each Level

### Single Task (No Hierarchy)
- Small feature (1-2 files, ~1 session)
- Work is atomic, no natural breakdown

### Task with Subtasks
- Medium feature (3-5 files, 3-7 steps)
- Work naturally decomposes into discrete steps

### Milestone with Tasks
- Large initiative (multiple areas, many sessions)
- Work spans 5+ distinct tasks

## Subtask Best Practices

Each subtask should be:
- **Independently understandable**: Clear on its own
- **Linked to parent**: Reference parent, explain how this piece fits
- **Specific scope**: What this subtask does vs what parent/siblings do
- **Clear completion**: Define "done" for this piece specifically

## Decomposition Strategy

1. **Assess scope**: Is this milestone-level (5+ tasks) or task-level (3-7 subtasks)?
2. Create parent task/milestone with overall goal and context
3. Analyze and identify 3-7 logical children
4. Create children with specific contexts and boundaries
5. Work through systematically, completing with results

### Don't Over-Decompose

- **3-7 children per parent** is usually right
- If you'd only have 1-2 subtasks, just make separate tasks
- If you need depth 3+, restructure your breakdown

## Completion Rules

1. **Cannot complete with pending children**
2. **Complete children first** - work through subtasks systematically
3. **Parent result summarizes overall implementation**

## Blocking Dependencies

```javascript
// Create task that depends on another
const deployTask = await tasks.create({
  description: "Deploy to production",
  blockedBy: [testTaskId, reviewTaskId]
});
```

**Use blockers when:** Task B cannot start until Task A completes.
**Don't use blockers when:** Tasks can be worked on in parallel.
