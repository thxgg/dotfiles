# UI Evidence Artifact Conventions

Use the root selected by the [Artifact Folder rule](../SKILL.md#artifact-folder). An environment-selected root can be outside the app repository. Resolve relative roots from the app repository; keep the fallback there, not in the dotfiles repository unless it is the app under test.

## Directory Layout

Select `<artifact-root>` using the [Artifact Folder rule](../SKILL.md#artifact-folder). Use one folder per evidence run:

```text
<artifact-root>/ui-evidence/
└── YYYYMMDD-HHMMSS-<slug>/
    ├── before.png
    ├── after.png
    ├── comparison-cropped.png
    ├── flow.webm
    └── notes.md
```

Examples:

```text
<artifact-root>/ui-evidence/20260604-153012-dashboard-empty-state/
<artifact-root>/ui-evidence/20260604-154905-reservations-filter/
```

## Naming

Use these standard filenames when applicable:

| File | Use |
| --- | --- |
| `before.png` | Baseline screenshot before code changes |
| `after.png` | Screenshot after code changes |
| `before-full.png` | Full-page baseline screenshot |
| `after-full.png` | Full-page after screenshot |
| `before-annotated.png` | Baseline screenshot with agent-browser annotations |
| `after-annotated.png` | After screenshot with agent-browser annotations |
| `comparison-cropped.png` | Preferred side-by-side cropped before/after comparison for small visual changes |
| `flow.webm` | Focused interaction recording |
| `notes.md` | Scenario notes, URL, viewport, caveats |

If multiple states are needed, use clear suffixes:

```text
before-empty.png
after-empty.png
after-with-results.png
single-line-comparison-cropped.png
flow-keyboard-navigation.webm
```

## Notes File

When the scenario has non-obvious setup, write `notes.md`:

```md
# UI Evidence Notes

Scenario: Reservations filter empty state
URL: http://localhost:3000/reservations
Viewport: 1440x1000
Theme: light
Auth/session: task-specific named browser session (no credentials)

Artifacts:
- before.png
- after.png
- flow.webm

Caveats:
- Local dev data seeded with test reservations.
```

## Git Policy

Follow the [evidence Git policy](../SKILL.md#pr-attachments). Project-required evidence needs no separate tracking approval. Otherwise treat the run folder as generated output. Maintained visual-test fixtures are separate from review evidence.

Final answers should still list the local artifact paths so the user can inspect them.
