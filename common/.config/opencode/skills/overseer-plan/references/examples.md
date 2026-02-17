# Examples

## Example 1: With Breakdown

### Input (`auth-plan.md`)

```markdown
# Plan: Add Authentication System

## Implementation
1. Create database schema for users/tokens
2. Implement auth controller with endpoints
3. Add JWT middleware for route protection
4. Build frontend login/register forms
5. Add integration tests
```

### Execution

```javascript
const milestone = await tasks.create({
  description: "Add Authentication System",
  context: `<full-markdown>`,
  priority: 1
});

const subtasks = [
  { desc: "Create database schema for users/tokens", done: "Migration runs, tables exist" },
  { desc: "Implement auth controller with endpoints", done: "Endpoints return expected responses" },
  { desc: "Add JWT middleware for route protection", done: "Unauthorized requests return 401" },
  { desc: "Build frontend login/register forms", done: "Forms render, submit without errors" },
  { desc: "Add integration tests", done: "`npm test` passes with auth coverage" }
];

for (const sub of subtasks) {
  await tasks.create({
    description: sub.desc,
    context: `Part of 'Add Authentication System'.\n\nDone when: ${sub.done}`,
    parentId: milestone.id
  });
}

return { milestone: milestone.id, subtaskCount: subtasks.length };
```

## Example 2: No Breakdown

### Input (`bugfix-plan.md`)

```markdown
# Plan: Fix Login Validation Bug

## Problem
Login fails when username has spaces

## Solution
Update validation regex in auth.ts line 42
```

### Execution

```javascript
const milestone = await tasks.create({
  description: "Fix Login Validation Bug",
  context: `<full-markdown>`,
  priority: 1
});

return { milestone: milestone.id, breakdown: false };
```

## Example 3: Epic-Level (Two-Level Hierarchy)

### Input

```markdown
# Complete User Authentication System

## Phase 1: Backend Infrastructure
1. Database schema for users/sessions
2. Password hashing with bcrypt

## Phase 2: API Endpoints
1. POST /auth/register
2. POST /auth/login

## Phase 3: Frontend
1. Login/register forms
2. Protected routes
```

### Execution

```javascript
const milestone = await tasks.create({
  description: "Complete User Authentication System",
  context: `<full-markdown>`,
  priority: 1
});

const phases = [
  { name: "Backend Infrastructure", items: [
    { desc: "Database schema", done: "Migration runs, tables exist" },
    { desc: "Password hashing", done: "bcrypt hashes verified in tests" }
  ]},
  { name: "API Endpoints", items: [
    { desc: "POST /auth/register", done: "Creates user, returns 201" },
    { desc: "POST /auth/login", done: "Returns JWT on valid credentials" }
  ]},
  { name: "Frontend", items: [
    { desc: "Login/register forms", done: "Forms render, submit successfully" },
    { desc: "Protected routes", done: "Redirect to login when unauthenticated" }
  ]}
];

for (const phase of phases) {
  const phaseTask = await tasks.create({
    description: phase.name,
    parentId: milestone.id
  });
  for (const item of phase.items) {
    await tasks.create({
      description: item.desc,
      context: `Part of '${phase.name}'.\n\nDone when: ${item.done}`,
      parentId: phaseTask.id
    });
  }
}

return milestone;
```
