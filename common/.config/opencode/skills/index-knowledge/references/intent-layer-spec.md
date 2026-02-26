# Intent Layer Specification

A comprehensive reference for creating and maintaining intent layer systems.

## Core Definition

An **intent layer** is a hierarchical system of documentation files (intent nodes) that provides AI agents with context-aware guidance. Each node is placed at a semantic boundary in the codebase and automatically loads when an agent works in that area.

The primary file name is `AGENTS.md`, which AI tools recognize and load automatically.

## Intent Node Components

Each intent node should contain these sections:

### Purpose & Scope
- Clear statement of what this area of code handles
- Explicit boundaries: what this area does NOT handle
- Key responsibilities and ownership

### Entry Points & Contracts
- Main APIs, functions, or interfaces
- Invariants that must always hold
- Input/output contracts
- Error handling expectations

### Usage Patterns
- Canonical examples showing the "right way"
- Code snippets from the actual codebase
- Common use cases with working examples

### Anti-Patterns
- What NOT to do, with concrete examples
- BAD vs GOOD comparisons
- Common mistakes and why they're problematic

### Dependencies & Edges
- **Uplink**: Link to parent AGENTS.md in hierarchy
- **Downlinks**: Links to child AGENTS.md files
- External dependencies and integration points

### Patterns & Pitfalls
- Lessons learned from real issues
- Edge cases to watch for
- Debugging tips and troubleshooting

## Hierarchical Structure

Intent layers form a tree structure following the codebase directory layout:

```
/AGENTS.md                        # Root node
├── /src/AGENTS.md                # Source layer
│   ├── /src/api/AGENTS.md        # API layer
│   ├── /src/components/AGENTS.md # Components layer
│   └── /src/utils/AGENTS.md      # Utilities layer
└── /tests/AGENTS.md              # Tests layer
```

### Hierarchical Loading

When an agent works in a file, all ancestor AGENTS.md files are loaded:

Working in `/src/api/users.ts` loads:
1. `/AGENTS.md` (root)
2. `/src/AGENTS.md` (source)
3. `/src/api/AGENTS.md` (API)

This provides progressive context from general to specific.

### Downlinks Format

Use relative markdown links for child nodes:

```markdown
## Navigation

- Uplink: [Root](../AGENTS.md)
- Downlinks:
  - [API Layer](./api/AGENTS.md) - REST and GraphQL handlers
  - [Components](./components/AGENTS.md) - Reusable UI components
  - [Utils](./utils/AGENTS.md) - Shared utility functions
```

## Least Common Ancestor (LCA) Principle

Place documentation at the least common ancestor of the files it affects:

- Documentation about a single module → that module's AGENTS.md
- Documentation about component/service interaction → their common parent
- Project-wide standards → root AGENTS.md

This prevents duplication and ensures context loads when needed.

## Token Budget Guidelines

Keep each node efficient to maximize AI context window:

| Node Type | Target Size | Maximum |
|-----------|-------------|---------|
| Root | 2,000 tokens | 4,000 tokens |
| Layer | 1,500 tokens | 3,000 tokens |
| Leaf | 1,000 tokens | 2,000 tokens |

### Token Efficiency Tips

1. **Use downlinks for detail**: Link to child nodes instead of including everything
2. **Reference, don't duplicate**: Point to existing docs instead of copying
3. **Be specific, not exhaustive**: Focus on what AI agents actually need
4. **Use code examples sparingly**: One good example beats three mediocre ones

## Maintenance Flywheel

Intent layers improve through a continuous process:

### 1. Observe Issues
- Notice when AI makes mistakes in an area
- Identify patterns of confusion or errors
- Track questions that come up repeatedly

### 2. Update Documentation
- Add anti-patterns for observed mistakes
- Clarify ambiguous sections
- Add examples for complex patterns

### 3. Verify Improvements
- Test that AI behavior improves
- Check that documentation loads correctly
- Ensure links remain valid

### 4. Propagate Changes
- Update related nodes if patterns change
- Adjust parent nodes for architectural changes
- Remove outdated information

## File Naming Conventions

- **Primary**: `AGENTS.md` (uppercase, recognized by OpenCode)
- **Alternatives**: `AGENTS.md`, `CONTEXT.md` (for other AI tools)
- **Placement**: At semantic boundaries, not every directory

## When to Create a New Node

Create a AGENTS.md when:
- A directory represents a distinct architectural layer
- Code in the directory has unique patterns or constraints
- AI frequently makes mistakes in that area
- The area has complex dependencies or contracts

Don't create a node when:
- The directory is trivial or self-explanatory
- Parent documentation sufficiently covers the area
- It would duplicate information from nearby nodes

## Cross-References

For linking between non-hierarchical nodes (siblings, cousins):

```markdown
## Related Areas
- See [Authentication](../auth/AGENTS.md) for auth patterns
- See [Database](../db/AGENTS.md) for query patterns
```

Use these sparingly to avoid circular dependencies in documentation.
