# Best Practices for Writing OpenCode Skills

Patterns for effective, maintainable, token-efficient skills.

## Design Principles

### 1. Single Responsibility

Each skill should do one thing well. Instead of a monolithic "project-manager" skill:
- `create-component` -- Create new components
- `run-tests` -- Execute test suites
- `deploy` -- Handle deployments

### 2. Clear Descriptions

Start with an action verb, include WHAT + WHEN, stay specific.

Good: `Generate unit tests for TypeScript functions. Use when asked to write tests.`
Bad: `This skill helps with testing`

### 3. Progressive Disclosure

Keep SKILL.md focused on essentials. Push details to `references/`.

**Three-Tier Loading Model:**

| Tier | Content | Token Cost | When Loaded |
|------|---------|------------|-------------|
| 1 | name + description | ~100 | Agent startup (all skills) |
| 2 | SKILL.md body | ~1500 | Skill triggered |
| 3 | references/, scripts/ | ~800 each | On-demand |

Proper navigation keeps budget at 2-5K tokens. Poor navigation explodes to 10K+.

**When to split:**
- Content > 200 lines
- Different tasks need different content
- Sections are mutually exclusive
- Large reference tables/schemas

## Writing Instructions

### Be Explicit

Tell the agent exactly what to do, step by step:

```markdown
1. Read the file at $ARGUMENTS
2. Identify all exported functions
3. For each function, generate a test covering happy path, edge cases, errors
4. Write tests to `__tests__/<filename>.test.ts`
```

### Handle Edge Cases

```markdown
- If the file does not exist, inform the user and stop
- If no functions are found, suggest checking the file path
- If tests already exist, ask whether to overwrite or append
```

### Provide Examples

Show what good output looks like so the agent has a concrete target.

## Navigation Patterns

### "In This Reference" Table

Always include in SKILL.md for multi-file skills:

```markdown
| File | Purpose |
|------|---------|
| [api.md](./references/api.md) | Runtime APIs |
| [config.md](./references/config.md) | Setup |
```

### "Reading Order" Table

Guide task-based navigation:

```markdown
| Task | Files |
|------|-------|
| New project | README + config |
| Add feature | README + api + patterns |
| Debug | gotchas |
```

### Decision Trees

For large skills, route the agent to the right sub-section:

```
What do you need?
|-- Store data -> storage/
|-- Run code -> compute/
'-- Auth -> identity/
```

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Vague instructions | Agent guesses wrong | Numbered steps with specifics |
| Assuming context | Agent can't find files | Search order + fallback logic |
| Ignoring errors | Silent failures | Check results, offer fixes |
| Monolithic SKILL.md | Context rot | Split to references/, < 200 lines |
| Duplicated content | Staleness, bloat | Link, don't copy |

## Testing

1. Invoke with typical arguments
2. Try edge cases (empty input, invalid input)
3. Verify output meets expectations

### Checklist

- [ ] Skill appears in available skills listing
- [ ] Description accurately describes functionality
- [ ] All referenced files exist and are readable
- [ ] Scripts are executable
- [ ] SKILL.md under 200 lines
- [ ] Reference files under 200 lines each

## Maintenance

- Update SKILL.md when behavior changes
- Update references when adding features
- Remove outdated examples
- When retiring: add deprecation notice, point to replacement, keep working during transition
