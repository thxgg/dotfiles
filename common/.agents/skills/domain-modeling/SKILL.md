---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a GLOSSARY.md or legacy CONTEXT.md, or recording or editing an ADR.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `GLOSSARY.md` or legacy `CONTEXT.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

### Select the existing convention

- Read applicable `GLOSSARY.md` and legacy `CONTEXT.md` files. Follow `GLOSSARY-MAP.md` and `CONTEXT-MAP.md` links to find the relevant contexts.
- Keep the repository's established filenames and documented ownership. A context reached through a map keeps its existing path, even if another context uses different names.
- If both conventions exist for the same context, inspect both and follow repository instructions and map links. If ownership is unclear or definitions conflict, ask which file is authoritative before writing. Do not silently prefer, merge, rename, or duplicate them.
- If no convention exists, use `GLOSSARY.md` for new glossary files and `GLOSSARY-MAP.md` when multiple contexts need a map. Do not create a second glossary when an existing `CONTEXT.md` already serves that purpose.

The examples below show the supported legacy convention. For a new repository without an established convention, use `GLOSSARY.md` in place of `CONTEXT.md` and `GLOSSARY-MAP.md` in place of `CONTEXT-MAP.md`.

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `GLOSSARY-MAP.md` or `CONTEXT-MAP.md` exists at the root, use it to find the contexts. A legacy map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily: only when you have something to write. If the relevant context has no glossary, create one under the selected convention when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in the selected glossary, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update the selected glossary inline

When a term is resolved, update the selected `GLOSSARY.md` or legacy `CONTEXT.md` right there. Don't batch these up: capture them as they happen. Use the shared [glossary format](./CONTEXT-FORMAT.md), which supports both filename conventions.

The glossary should be totally devoid of implementation details. Do not treat it as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
