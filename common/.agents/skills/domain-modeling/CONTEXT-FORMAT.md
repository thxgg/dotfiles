# Glossary Format (`GLOSSARY.md` or legacy `CONTEXT.md`)

This format supports both conventions. Keep this resource's legacy filename so existing skill links continue to work. Select the target file using the convention rules in [SKILL.md](./SKILL.md); do not rename an existing project file merely to match upstream.

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Single vs multi-context repos

**Single context (most repos):** One `GLOSSARY.md` or legacy `CONTEXT.md` at the repo root.

**Multiple contexts:** A `GLOSSARY-MAP.md` or legacy `CONTEXT-MAP.md` at the repo root lists the contexts, where they live, and how they relate to each other. Follow its actual links. This example uses the legacy convention; use `GLOSSARY.md` paths and a `GLOSSARY-MAP.md` file for a new repository without an established convention:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md): receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md): generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md): manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

The skill infers which structure applies:

- If `GLOSSARY-MAP.md` or `CONTEXT-MAP.md` exists, read it to find contexts and preserve the linked paths.
- If only a root `GLOSSARY.md` or `CONTEXT.md` exists, use that file for the single context.
- If both conventions exist for the same context, inspect both and follow documented ownership. Ask before writing if authority is unclear or definitions conflict. Do not create duplicate glossaries or rename existing files.
- If neither exists, create a root `GLOSSARY.md` lazily when the first term is resolved, unless repository instructions establish a different convention.

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.
