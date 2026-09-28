# Skill sources and exceptions

## Ownership and discovery

| Location | Role |
| --- | --- |
| Dotfiles `common/.agents/skills/` | Vendored personal skill sources used by local agents |
| Dotfiles `common/.agents/skills/SOURCES.md` | Recorded upstream revisions and deliberate deviations; read this first |
| `~/.agents/skills/` | Installed local skills, commonly symlinks into dotfiles; inspect other configured local discovery roots too |
| Project `.agents/skills/` | Repository-owned workflows; follow that repository's guidance |
| `~/.cache/amp/repositories/ampcode.com-user-skills` | Canonical editable personal Amp skills clone; confirm remote with `amp skills repositories` |
| `~/.cache/amp/global-skills/` | Read-only server materialization; never edit it |

Local skills currently take precedence over matching account skills on the Mac. This is intentional. Keep local copies for other agents and preserve Amp-specific adaptations in the account copy. Do not remove shared links to fix a name overlap. Diagnose broken links from their installer/source so a later deployment does not recreate them.

Claude skill discovery was disabled in Amp. Do not restore Claude-only skills or enable that discovery during a source sync. `visual-explainer` was removed, and `pick-ui-library` is intentionally excluded.

## Original sources

Read the current `SOURCES.md` rather than treating these revisions as update targets. They identify recoverable bases, not the latest releases. If that file is unavailable, these are the recorded baselines from the original maintenance:

| Skills | Upstream and baseline |
| --- | --- |
| `coding-standards` | [dmmulroy/skills](https://github.com/dmmulroy/skills), [8603380](https://github.com/dmmulroy/skills/commit/8603380821fee6a77c82639f364ce8fe4f5a92be) |
| `improve-codebase-architecture`, `tech-spec` | Same repository, [8a10f56](https://github.com/dmmulroy/skills/commit/8a10f56abf86dc52e8209e5f61fffa6951402974); tech-spec's inline interview also follows [cbd1929](https://github.com/dmmulroy/skills/commit/cbd1929589267453029859a43d2ecf411c865b54) |
| `domain-modeling` | [mattpocock/skills](https://github.com/mattpocock/skills), `skills/engineering/domain-modeling` at [c55ee46](https://github.com/mattpocock/skills/commit/c55ee46073ed923f86ce59a5eb3b6d895095d1b7) |
| `code-review`, `grilling`, `grill-me`, `grill-with-docs`, `tdd` | Matt Pocock [d574778](https://github.com/mattpocock/skills/commit/d574778f94cf620fcc8ce741584093bc650a61d3), imported through Dillon's `scripts/sync-matt-skills.sh`; inspect both sources rather than replacing Dillon's adaptations with Matt's defaults |
| `install-anti-slop` | [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), `skills/install-anti-slop` at [c44ef22](https://github.com/dmmulroy/anti-slop/commit/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b) |
| Eleven Emil skills listed below | [emilkowalski/skills](https://github.com/emilkowalski/skills), [d16ebe6](https://github.com/emilkowalski/skills/commit/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128) |
| `herdr`, `postgres`, `shadcn-vue`, `ui-evidence` | Owner-maintained; no skill upstream was identified. Product documentation is not an upstream skill source. |

The eleven Emil skills are `animate`, `animate-expo`, `animation-vocabulary`, `apple-design`, `ask-sonner`, `emil-design-eng`, `find-animation-opportunities`, `improve-animations`, `prototype`, `review-animations`, and `write-swift`.

Preserve their full references and recipes. The local `write-swift/SKILL.md` omits an upstream trailing blank line for whitespace checks. Do not create a material conflict from that difference.

## Customizations to preserve

| Skill | Required preservation |
| --- | --- |
| `improve-codebase-architecture` | Retained despite upstream deletion. Keep the read-only scan and user-selected handoff to `tech-spec`; do not auto-run the spec. In Amp, load `coding-standards` by name. |
| `tech-spec` | Inline one-question-at-a-time interview, without interview sub-skill calls. Retain standards/TDD dependencies and native, portable delegation. Account version uses named skill calls, not `../` sibling paths. |
| `tdd` | Dillon's testing overrides: real seams and recording fakes, no module mocking or method spies. Account version loads `coding-standards` by name. |
| `code-review` | Separate committed and work-in-progress review scopes. WIP includes staged, unstaged, and in-scope untracked files. Both reviewers receive the same captured evidence. Preserve tracker inference without requiring a setup skill. |
| `grilling` | One question at a time, not upstream batched questions. |
| `grill-me`, `grill-with-docs` | Thin wrappers around `grilling`, with `domain-modeling` for the latter. Account versions use named skill calls. |
| `shadcn-vue` | Owner-maintained Vue/Nuxt guidance and customized component APIs. Local version includes Pi's no-inline-shell-preprocessing warning; account version omits that Pi-specific sentence. Do not replace it with a React/shadcn skill. |
| `ui-evidence` | Environment artifact directory wins, then project convention, then fallback. Preserve before/after and attachment guidance; do not hard-code `.agents/artifacts/` when the environment specifies `.amp/in/artifacts/`. |
| `animate` | Account version replaces the excluded `pick-ui-library` dependency with existing component conventions and approval before a new dependency. |
| `improve-animations` | Account version uses Amp's native delegation rules and no automatic worktree/thread. Explicit implementation mode remains available; ordinary audits remain read-only. |
| `herdr` | Require `HERDR_ENV=1`. Account version uses native agent delegation, not terminal-launched agents. Preserve ordinary pane/server control. |
| `install-anti-slop` | Preserve manual-only invocation metadata, complete assets, installer, and update reference. Follow its vendored-code merge procedure rather than overwriting local policy. |
| Project `qa-bug-report-writer` | Manual invocation only. A pasted error or bug mention must not activate it. This is repository-owned, not an upstream personal skill. |

Other repository workflow skills and the five personal integration skills (`database-staging`, `hubspot-staging`, `inspecting-sonarcloud`, `stripe-business-staging`, `stripe-memberships-staging`) are owner/repository-managed unless current provenance says otherwise. Do not invent upstreams for them.

## Updating source and account copies

1. Read upstream history and source layout at an immutable commit. Repositories can move or remove skills. Use external repository tools for upstream understanding; do not mistake a package cache for authoritative upstream.
2. Recover the base from `SOURCES.md` and relevant commits. Merge upstream changes with local patches; retain intentionally deleted/excluded skills.
3. For anti-slop, load `install-anti-slop` and read its update reference. Review executable assets and licenses. In an upstream checkout, follow its required checks and asset-sync commands; test the installer against disposable data, not the live application. Updating the skill bundle is not permission to update every project's vendored rules.
4. Record the actual merged revision and remaining deviations in the existing provenance record. For partial updates, do not claim the entire skill matches a new baseline.
5. If both destinations are in scope, first preserve the local portable version, then merge the result into the account copy with its Amp adaptations. Compare complete directory trees, not just `SKILL.md`. Preserve text assets; Amp does not serve binary skill resources.
6. Verify local discovery and account publication separately. `amp skills list` describes discovery but does not reload an existing session. A stale session list is not evidence that a removed file still exists.

Do not run broad installation or dotfiles deployment scripts as an update check. They can recreate links or replace unrelated configuration. Follow the dotfiles repository's current scoped deployment rules only when deployment is requested.
