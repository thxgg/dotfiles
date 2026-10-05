# Vendored Skill Sources

## Dillon Mulroy

`coding-standards` matches
[`dmmulroy/skills@8603380`](https://github.com/dmmulroy/skills/commit/8603380821fee6a77c82639f364ce8fe4f5a92be).

The following skills retain their baseline from
[`dmmulroy/skills@8a10f56`](https://github.com/dmmulroy/skills/commit/8a10f56abf86dc52e8209e5f61fffa6951402974):

- `improve-codebase-architecture`: retained despite its deletion upstream.
- `tech-spec`: retains local standards/TDD references and portable delegation instructions.
  Its interview instructions are inline, without interview sub-skill calls, following
  [`dmmulroy/skills@cbd1929`](https://github.com/dmmulroy/skills/commit/cbd1929589267453029859a43d2ecf411c865b54).

## Matt Pocock

`domain-modeling` matches `skills/engineering/domain-modeling` at
[`mattpocock/skills@c55ee46`](https://github.com/mattpocock/skills/commit/c55ee46073ed923f86ce59a5eb3b6d895095d1b7).

The remaining Matt Pocock-derived skills retain their baseline from
[`mattpocock/skills@d574778`](https://github.com/mattpocock/skills/commit/d574778f94cf620fcc8ce741584093bc650a61d3)
through Dillon's `scripts/sync-matt-skills.sh`:

- `code-review`
- `grilling`
- `grill-me`
- `grill-with-docs`
- `tdd`

Dillon's TDD override is retained. Local cross-harness patches make skill-to-skill
invocation and parallel review delegation portable between Pi and Claude, and
make `code-review` infer an issue tracker without `setup-matt-pocock-skills`.
`code-review` also distinguishes committed reviews from work-in-progress reviews,
including staged, unstaged, and in-scope untracked changes in the latter.
`grilling` retains one-question-at-a-time interviews rather than upstream's
batched questions. Do not replace these customizations during an upstream sync.

## Anti-slop

`install-anti-slop` matches `skills/install-anti-slop` at
[`dmmulroy/anti-slop@c44ef22`](https://github.com/dmmulroy/anti-slop/commit/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b),
except for the retained `disable-model-invocation: true` frontmatter flag.
Its previous baseline was reconstructed as
[`446268e`](https://github.com/dmmulroy/anti-slop/commit/446268e5d15baa968eaec669ff65358d36ae6259).

## Emil Kowalski

The following skills match
[`emilkowalski/skills@d16ebe6`](https://github.com/emilkowalski/skills/commit/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128):

- `animate`
- `animate-expo`
- `animation-vocabulary`
- `apple-design`
- `ask-sonner`
- `emil-design-eng`
- `find-animation-opportunities`
- `improve-animations`
- `prototype`
- `review-animations`
- `write-swift`

The trailing blank line in `write-swift/SKILL.md` is removed for whitespace checks.

`pick-ui-library` is intentionally excluded by owner decision.

## Matt Silverlock

`wow-addon-development` copies `SKILL.md` and all seven references unchanged from
[`elithrar/dotfiles@4b38887`](https://github.com/elithrar/dotfiles/commit/4b38887ec969bbc1c97c1434732fac97ea7ff0dd),
under `.agents/skills/wow-addon-development`. The upstream MIT license is included
as `wow-addon-development/LICENSE`.

`agents/openai.yaml` is intentionally omitted: it contains Codex interface metadata
and a skill-invocation prompt, not OpenAI model-specific guidance. Historical
`.agents/skill-evals/wow-addon-development` records are not part of the imported
skill. They describe earlier OpenAI model runs, not current model instructions or
bundled executable tests. All portable development and validation guidance is retained.

## No upstream

The owner confirmed that these skills have no upstream:

- `herdr`
- `postgres`
- `shadcn-vue`
- `ui-evidence`

`maintaining-agent-integrations` is owner-maintained. It was copied with its
references from the personal Amp skills repository
(`https://ampcode.com/git/@thxgg/-/skills`). The local copy makes Amp built-in
skill loading and session reload conditional so other agents can use it.
Keep its source records and maintenance decisions aligned with the account copy
when updating both destinations; neither copy is an external upstream.
