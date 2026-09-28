---
name: maintaining-agent-integrations
description: Reviews and updates personal agent skills and MCP configurations. Use for upstream skill syncs, preserving local or Amp adaptations, Pi Ephemeral maintenance, and pinned MCP package or database image updates across Pi, Codex, Claude, OpenCode, and Amp.
---

# Maintain personal skills and MCPs

Maintain the owner's agent setup without replacing deliberate customizations with upstream defaults.

## Establish the scope

Distinguish an inventory request from an update request. An inventory is read-only. For updates, establish which clients, resources, and destinations are included. Keep **local Mac configuration** and **Amp account/workspace configuration** separate. A request for local maintenance does not include Amp.

In Amp, load `building-skills` before changing skills and `building-plugins` if plugin changes are included. In other clients, use their skill-authoring guidance when available; the Amp built-ins are not prerequisites. Load related skills through the current client's native mechanism or read their installed files. Do not assume sibling skill directories exist in an Amp cache.

Read the applicable repository guidance and inspect existing changes. Use the references for this owner's sources and deliberate exceptions:

- [Skill sources and merge rules](references/skills.md)
- [MCP locations and pin-update procedure](references/mcps.md)

These references record the September 2026 maintenance baseline. Recheck current files and source records before acting. Do not restore an old version, removed integration, or permission just because it appears here.

## Discover the source of truth

1. Locate the relevant checkout. Usual Mac locations are `~/Projects/Personal/dotfiles` and `~/Projects/Work/code-hospitality-monorepo`. Confirm them instead of creating these paths elsewhere.
2. Resolve installed symlinks. Distinguish tracked sources, ignored machine-local files, generated caches, account repositories, and catalog entries. A file under a Git checkout can still be ignored.
3. For skills, inspect the full directory, provenance, Git history, and intentional patches before comparing with upstream. An empty installer lockfile is not a complete skill inventory.
4. For MCPs, parse definitions and client precedence without starting servers. Inspect enabled plugins and skill-bundled MCPs as well as direct configuration. A catalog, cache, or install manifest does not prove a live connection.
5. Report scope and uncertainty. If running in an orb without the Mac's files, inspect only accessible sources and name the gap. Do not reconstruct machine-local state from this skill.

## Apply an update

For skills, compare **pristine base → current local** and **pristine base → selected upstream revision**. Preserve unexplained differences. If the base cannot be recovered, port understood changes conservatively and report that limitation. Do not use a blanket directory replacement or a generic installer update over customized skills.

For MCPs, distinguish **pinning the current installation** from **upgrading to a new release**. Inspect installed versions first. For an upgrade, resolve the requested release from the authoritative registry/repository and read compatibility notes. Record the old and selected versions before editing.

Change every in-scope effective definition and its catalog/template where applicable. Do not edit every client merely because it contains the same service. Preserve credentials, account/environment selection, access modes, tool filters, approval rules, and disabled states unless their change is explicitly requested.

## Verify and deliver

- Re-read edited files and compare against the captured state. Check that only authorized fields or skill behavior changed.
- Parse JSON/TOML/YAML. Use an installed Python 3.11+ for `tomllib`; the Mac's bare `python3` may be older. Compile Python source in memory to avoid generated files.
- Check skill metadata, bundled resources, relative links, and text-file support. Preserve complete resource trees and licenses. Scan proposed commits for secrets.
- Check package versions against registry metadata. For Docker, verify the repository digest and supported architecture. Configuration validity does not prove a server can connect.
- Do not start databases, SSH/SSM tunnels, credential flows, or MCP servers merely to inspect configuration. With authorization for live validation, use the least-invasive check and report which environment it contacted.
- Run repository-required checks for affected tracked code. For dotfiles skill/link changes, consult `tests/README.md`; its shared configuration test uses temporary homes.
- For prompt changes, offer a small behavior evaluation if useful; do not run model-based evaluations without approval.
- Commit and push only to explicitly authorized repositories. An ignored local configuration fix does not authorize force-adding that file to Git. Amp publication requires pushing the canonical skills repository; editing a cache is not publication.
- After an authorized Amp skill push, use `reload_skills` if available; otherwise tell the user to reload the Amp session. Verify the server-synced content where accessible and which source wins locally. Do not claim the adapted account copy is active when a local copy overrides it.

Finish with: changes made, preserved customizations, selected versions, checks and limits, publication state, and any client reload needed. State what remains pending without turning recommendations into extra changes.
