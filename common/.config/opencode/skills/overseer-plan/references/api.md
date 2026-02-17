# Overseer Codemode MCP API

Execute JavaScript code to interact with Overseer task management.

## Task Interfaces

```typescript
interface Task {
  id: string;
  parentId: string | null;
  description: string;
  priority: 0 | 1 | 2;
  completed: boolean;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  result: string | null;
  commitSha: string | null;
  depth: 0 | 1 | 2;
  blockedBy?: string[];
  blocks?: string[];
  bookmark?: string;
  startCommit?: string;
  effectivelyBlocked: boolean;
  cancelled: boolean;
  cancelledAt: string | null;
  archived: boolean;
  archivedAt: string | null;
}

interface TaskWithContext extends Task {
  context: {
    own: string;
    parent?: string;
    milestone?: string;
  };
  learnings: {
    own: Learning[];
    parent: Learning[];
    milestone: Learning[];
  };
}

interface TaskTree {
  task: Task;
  children: TaskTree[];
}

interface TaskProgress {
  total: number;
  completed: number;
  ready: number;
  blocked: number;
}

type TaskType = "milestone" | "task" | "subtask";
```

## Tasks API

```typescript
declare const tasks: {
  list(filter?: { parentId?: string; ready?: boolean; completed?: boolean; depth?: 0|1|2; type?: TaskType; archived?: boolean|"all" }): Promise<Task[]>;
  get(id: string): Promise<TaskWithContext>;
  create(input: { description: string; context?: string; parentId?: string; priority?: 0|1|2; blockedBy?: string[] }): Promise<Task>;
  update(id: string, input: { description?: string; context?: string; priority?: 0|1|2; parentId?: string }): Promise<Task>;
  start(id: string): Promise<Task>;
  complete(id: string, input?: { result?: string; learnings?: string[] }): Promise<Task>;
  reopen(id: string): Promise<Task>;
  cancel(id: string): Promise<Task>;
  archive(id: string): Promise<Task>;
  delete(id: string): Promise<void>;
  block(taskId: string, blockerId: string): Promise<void>;
  unblock(taskId: string, blockerId: string): Promise<void>;
  nextReady(milestoneId?: string): Promise<TaskWithContext | null>;
  tree(rootId?: string): Promise<TaskTree | TaskTree[]>;
  search(query: string): Promise<Task[]>;
  progress(rootId?: string): Promise<TaskProgress>;
};
```

## Learnings API

```typescript
declare const learnings: {
  list(taskId: string): Promise<Learning[]>;
};
```

**VCS (jj or git) is required** for `start`/`complete`. CRUD operations work without VCS.
