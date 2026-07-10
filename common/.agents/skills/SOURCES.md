# Vendored Skill Sources

Open Computer Use is sourced from
[`iFurySt/open-codex-computer-use@69e07b8`](https://github.com/iFurySt/open-codex-computer-use/commit/69e07b8ec33ad90256ac6e3c2c8e3f10479f963d):

- `open-computer-use`

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
