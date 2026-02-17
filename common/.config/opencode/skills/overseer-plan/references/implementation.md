# Implementation Instructions

**For the skill agent executing `/overseer-plan`.** Follow this workflow exactly.

## Step 1: Read Markdown File

Read the provided file using the Read tool.

## Step 2: Extract Title

- Parse first `#` heading as title
- Strip "Plan: " prefix if present (case-insensitive)
- Fallback: use filename without extension

## Step 3: Create Milestone via MCP

```javascript
const milestone = await tasks.create({
  description: "<extracted-title>",
  context: `<full-markdown-content>`,
  priority: <priority-if-provided-else-1>
});
return milestone;
```

With `--parent` option:

```javascript
const task = await tasks.create({
  description: "<extracted-title>",
  context: `<full-markdown-content>`,
  parentId: "<parent-id>",
  priority: <priority-if-provided-else-1>
});
return task;
```

## Step 4: Analyze Plan Structure

### Breakdown Indicators

1. **Numbered/bulleted implementation lists (3-7 items)**
2. **Clear subsections under implementation/tasks/steps**
3. **File-specific sections**
4. **Sequential phases**

### Do NOT Break Down When

- Only 1-2 steps/items
- Plan is a single cohesive fix
- Content is exploratory ("investigate", "research")
- Work items inseparable
- Plan very short (<10 lines)

## Step 5: Validate Atomicity & Acceptance Criteria

For each proposed task, verify:
- **Atomic**: Can be completed in single commit
- **Validated**: Has clear acceptance criteria

If no validation, add to context:
```
Done when: <specific observable criteria>
```

## Step 6: Oracle Review

Before creating tasks, invoke Oracle to review the proposed breakdown.

**Prompt Oracle with:**
```
Review this task breakdown for "<milestone>":
1. <task> - Done when: <criteria>
2. <task> - Done when: <criteria>

Check: Are tasks atomic? Is validation clear? Missing dependencies?
```

Incorporate Oracle's feedback, then proceed.

## Step 7: Create Subtasks (If Breaking Down)

### Flat Breakdown

```javascript
const subtasks = [
  { description: "Create database schema", context: "Part of '<milestone>'. Done when: Migration runs." },
  { description: "Build API endpoints", context: "Part of '<milestone>'. Done when: Endpoints return expected responses." }
];

const created = [];
for (const sub of subtasks) {
  const task = await tasks.create({
    description: sub.description,
    context: sub.context,
    parentId: milestone.id
  });
  created.push(task);
}
return { milestone: milestone.id, subtasks: created };
```

### Epic-Level Breakdown (phases with sub-items)

```javascript
const phase = await tasks.create({
  description: "Backend Infrastructure",
  context: "Phase 1 context...",
  parentId: milestoneId
});

for (const item of phaseItems) {
  await tasks.create({
    description: item.description,
    context: item.context,
    parentId: phase.id
  });
}
```

## Step 8: Report Results

Report: milestone ID, number of subtasks created, their descriptions, and how to view the structure.
