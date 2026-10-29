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

`domain-modeling` retains its `skills/engineering/domain-modeling` baseline at
[`mattpocock/skills@c55ee46`](https://github.com/mattpocock/skills/commit/c55ee46073ed923f86ce59a5eb3b6d895095d1b7).
It selectively adopts the glossary naming convention from
[`d80fa0f`](https://github.com/mattpocock/skills/commit/d80fa0f4ebe0c5714af0adf8670336065233ecc6),
with local compatibility rules: read both `GLOSSARY.md`/`GLOSSARY-MAP.md` and
legacy `CONTEXT.md`/`CONTEXT-MAP.md`, preserve existing paths and ownership,
and ask before writing when authority is unclear or definitions conflict.
New repositories default to glossary names. `CONTEXT-FORMAT.md` remains the
shared format resource to preserve existing links. `tdd` and the retained
`improve-codebase-architecture` use the same dual-convention discovery rules.

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

Selective updates reviewed against `mattpocock/skills@49dd158`:

- `code-review` adopts the explicit standards-file search from
  [`3da8c01`](https://github.com/mattpocock/skills/commit/3da8c01116264675eeefbd6e9d59c734de9095cc),
  without replacing local review scopes, captured evidence, tracker inference,
  or portable delegation.
- `tdd` adopts the one-line explanation of what each proposed seam catches and
  misses from [`3f59913`](https://github.com/mattpocock/skills/commit/3f599139104dfceabc7754eeb91319802f85e042).
  Its testing overrides remain; the new `codebase-design` dependency is not adopted.
- `grilling`, `grill-me`, and `grill-with-docs` remain unchanged by owner decision.

These are partial updates, not whole-skill baseline advances.

`code-review` also adopts the fresh-context requirement from
[`mattpocock/skills@7739eae`](https://github.com/mattpocock/skills/commit/7739eae),
reviewed at `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`. Reviewers receive the same
captured evidence, not a fork of the parent conversation. Harness delegation
policy and the existing local review behavior remain in force.

`writing-for-agents` and its complete supporting files match
[`mattpocock/skills@a496f55`](https://github.com/mattpocock/skills/commit/a496f5513d4a4cf889bc48e189e579f4b0bdf6aa),
under `skills/productivity/writing-for-agents`, except for
`disable-model-invocation: true`. This matches Dillon's manual-only copy.
The upstream license is retained as `LICENSE.matt-pocock`.

## Anti-slop

`install-anti-slop` matches `skills/install-anti-slop` at
[`dmmulroy/anti-slop@13909c9`](https://github.com/dmmulroy/anti-slop/commit/13909c9e07590f5a85d93c62712259fe14a883f7),
except for the retained `disable-model-invocation: true` frontmatter flag.
The update from [`c44ef22`](https://github.com/dmmulroy/anti-slop/commit/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b)
keeps consecutive single-line bindings grouped, including module-level exports.
Leading comments still start a separate group; existing blank lines remain.
The earlier baseline was reconstructed as
[`446268e`](https://github.com/dmmulroy/anti-slop/commit/446268e5d15baa968eaec669ff65358d36ae6259).

The owner previously excluded `require-readable-spacing` because it split these
binding groups. This update changes the skill bundle only. Preserve existing
project exclusions unless re-enabling the rule is explicitly requested.
Validation used the upstream pinned dependencies in a temporary checkout:
`pnpm check`, the new RuleTester suite against the installed bundle (and its
expected failure against the old bundle), CLI autofix stability, and installer
overwrite protection. No project lint configuration or dependency was changed.

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

The following skills and their complete supporting files match
[`emilkowalski/skills@2d22863`](https://github.com/emilkowalski/skills/commit/2d228630ba1446365f614a108cb8252f1feda202):

- `animation-performance`
- `break-ui`
- `mobile-native`

`remove-animations` matches
[`emilkowalski/skills@a81dbca`](https://github.com/emilkowalski/skills/commit/a81dbca07f2217b7103e510c0f13f8d5b017afc9),
except for the local `disable-model-invocation: true` flag. It is manual-only.

The upstream MIT license is included as `LICENSE.emil-kowalski`.

`pick-ui-library` is intentionally excluded by owner decision.

## Matt Silverlock

`wow-addon-development` copies `SKILL.md` and all seven references unchanged from
[`elithrar/dotfiles@1e94024`](https://github.com/elithrar/dotfiles/commit/1e9402420916e8bb5e4ae7b366ee0694b8d3aca7),
under `.agents/skills/wow-addon-development`. The upstream MIT license is included
as `wow-addon-development/LICENSE`.

`agents/openai.yaml` is intentionally omitted: it contains Codex interface metadata
and a skill-invocation prompt, not OpenAI model-specific guidance. Historical
`.agents/skill-evals/wow-addon-development` records are not part of the imported
skill. They describe earlier OpenAI model runs, not current model instructions or
bundled executable tests. All portable development and validation guidance is retained.

## PlanetScale

`postgres` comes from [planetscale/database-skills](https://github.com/planetscale/database-skills),
under `skills/postgres`. All 23 bundled files exactly match
[`f6ed002`](https://github.com/planetscale/database-skills/commit/f6ed002d03084cb39c01d1d58904d47a36f5322a).
No local patches are applied. The upstream MIT license is retained as `LICENSE.planetscale`.

The previous content baseline was `af0ce0cfb65cca4cc21d18ca0d9cf270ca99d488`.
The update adopts `a9b2585`: session-level `SET` warnings for pooled port 6432
in `ps-connections.md` and `ps-connection-pooling.md`.

## Herdr

`herdr` comes from [herdrdev/herdr](https://github.com/herdrdev/herdr), not local authorship.
Its `SKILL.md` exactly matches the repository-root `SKILL.md` at
[`3e8f9df`](https://github.com/herdrdev/herdr/commit/3e8f9df14e6dd08a8d80d920b923870a80649f0b).
This is a recoverable content baseline, not proof of the original import commit.
The current upstream path is `skills/herdr/SKILL.md`; compare against the installed
Herdr version before updating. The local skill remains unchanged.

## No upstream

The owner confirmed that these skills have no upstream:

- `shadcn-vue`
- `ui-evidence`

`maintaining-agent-integrations` is owner-maintained. It was copied with its
references from the personal Amp skills repository
(`https://ampcode.com/git/@thxgg/-/skills`). The local copy makes Amp built-in
skill loading and session reload conditional so other agents can use it.
Keep its source records and maintenance decisions aligned with the account copy
when updating both destinations; neither copy is an external upstream.
