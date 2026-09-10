# Vendored Skill Sources

The following shared skills are sourced from the Dillon Mulroy skill suite at
[`dmmulroy/skills@8a10f56`](https://github.com/dmmulroy/skills/commit/8a10f56abf86dc52e8209e5f61fffa6951402974):

- `coding-standards`
- `improve-codebase-architecture`
- `tech-spec`

The suite's Matt Pocock-derived skills were refreshed from
[`mattpocock/skills@d574778`](https://github.com/mattpocock/skills/commit/d574778f94cf620fcc8ce741584093bc650a61d3)
through Dillon's `scripts/sync-matt-skills.sh`:

- `code-review`
- `domain-modeling`
- `grilling`
- `grill-me`
- `grill-with-docs`
- `tdd`

Dillon's TDD override is retained. Local cross-harness patches make skill-to-skill
invocation and parallel review delegation portable between Pi and Claude, and
make `code-review` infer an issue tracker without `setup-matt-pocock-skills`.

## Additional upstream attribution

The owner confirmed these sources. Exact upstream revisions are not recorded.

Dillon Mulroy:

- `install-anti-slop`

Emil Kowalski:

- `animation-vocabulary`
- `emil-design-eng`
- `review-animations`

## No upstream

The owner confirmed that these skills have no upstream:

- `apple-design`
- `herdr`
- `postgres`
- `shadcn-vue`
- `ui-evidence`
