---
name: ui-evidence
description: Capture before/after screenshots or WebM recordings for UI-visible changes using agent-browser. Use when working on web UI changes, visual regressions, or interaction flows that need recorded evidence.
---

# UI Evidence

Use this skill when a task changes visible web UI and the final answer should include before/after screenshots or a short recording.

## Core Rule

Capture the UI in a repeatable way:

1. Identify the scenario: app, route, viewport, theme, auth/session, and interaction.
2. Create a run folder under `.agents/artifacts/ui-evidence/`.
3. Capture the **before** state before editing UI code.
4. Make the requested change.
5. Return to the same scenario with the same viewport/session/data.
6. Capture the **after** state and, when relevant, a WebM interaction recording.
7. For visual alignment/layout changes, prefer a cropped side-by-side before/after comparison image when feasible, while keeping individual before/after crops if they add context.
8. Report artifact paths in the final response.

If a project has `UI_EVIDENCE.md`, `.agents/ui-evidence.md`, or `.agents/ui-evidence.json`, read it before choosing routes or viewports. For backward compatibility, also honor legacy `.pi/ui-evidence.md` and `.pi/ui-evidence.json` files when present.

## Artifact Folder

Create a folder named:

```text
.agents/artifacts/ui-evidence/YYYYMMDD-HHMMSS-<slug>/
```

Use a short slug for the scenario, for example `reservations-filter` or `dashboard-empty-state`.

See [artifact conventions](references/artifact-conventions.md) for details.

## Browser Setup

Prefer `agent-browser` for all web UI evidence.

Basic setup:

```bash
agent-browser open <url>
agent-browser wait --load networkidle
agent-browser set viewport 1440 1000
agent-browser snapshot -i
```

Use refs from `snapshot -i` for interactions. Re-run `snapshot -i` after navigation, modal opens, form submission, or significant DOM changes.

See [agent-browser recording recipes](references/agent-browser-recording.md) for command examples.

## Screenshots

For static UI changes, capture screenshots:

```bash
agent-browser screenshot ./.agents/artifacts/ui-evidence/<run>/before.png
# make code changes and refresh/reopen same scenario
agent-browser screenshot ./.agents/artifacts/ui-evidence/<run>/after.png
```

Use `--full` only when the whole scrollable page matters. Use `--annotate` when element refs or layout explanation matters.

For small visual changes such as alignment, spacing, or icon/text positioning, prefer tightly cropped evidence. When feasible, produce a single side-by-side cropped comparison image (`*-comparison-cropped.png`) so reviewers can compare before and after at a glance.

## Videos

For interaction changes, record a short WebM:

```bash
agent-browser record start .agents/artifacts/ui-evidence/<run>/flow.webm
# perform the interaction using agent-browser refs
agent-browser record stop
```

Keep recordings focused: start immediately before the relevant interaction and stop immediately after the result is visible.

## Final Response

Always include:

- scenario name
- URL or route
- before screenshot path, if captured
- after screenshot path, if captured
- video path, if recorded
- important caveats, for example auth/data/dev-server assumptions

Use [the report template](templates/evidence-report.md) when a structured evidence section is useful.
