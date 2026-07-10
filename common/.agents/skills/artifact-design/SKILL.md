---
name: artifact-design
description: Design, build, validate, and visually inspect self-contained static or explicitly interactive HTML artifacts for the personal artifact cloud. Use when creating or substantially revising reports, dashboards, explainers, comparisons, plans, or data visualizations intended for publication with the artifact tool.
---

# Artifact Design

Build the artifact around its communication job, not a reusable visual template.

## Workflow

1. **Frame the job**
   - Identify the audience, primary question, reading order, and desired takeaway.
   - Choose the fitting form: report, dashboard, explainer, comparison, timeline, or visual essay.
   - Separate sourced facts from interpretation. Include provenance in the document when claims depend on external research.

2. **Design the information hierarchy**
   - Give the page one descriptive `<title>` and one clear `<h1>`.
   - Lead with the conclusion or key signal; move evidence and detail afterward.
   - Use semantic landmarks, headings, lists, tables, figures, and captions.
   - Prefer direct labels over legends and prose over decorative chart complexity.

3. **Build a self-contained document**
   - Embed CSS, images, fonts, and point-in-time data in one HTML file.
   - Default to static. Use `runtimeMode: "interactive"` only when interaction materially improves understanding.
   - Interactive artifacts are declarative: use `data-artifact-increment`, `data-artifact-toggle`, `data-artifact-show`, or `data-artifact-filter`. The trusted server runtime supplies behavior.
   - Never add `<script>`, event-handler attributes, forms, iframes, external assets, fetches, XHR, WebSockets, EventSource, workers, popups, downloads, or external navigation.
   - Do not fake controls. If interaction is unavailable, present the complete useful state statically.
   - Treat Catppuccin Latte/Mocha with Lavender as an optional project-consistent palette, not a mandatory aesthetic.

4. **Cover quality fundamentals**
   - Set `lang`, UTF-8 charset, responsive viewport, and useful description metadata.
   - Use fluid type and layout; avoid fixed widths that overflow at 390 px.
   - Ensure meaningful reading order, keyboard-visible links, sufficient contrast, and alt text.
   - Use tables for real tabular comparisons and provide mobile overflow behavior.
   - Add print styles for reports/explainers.
   - If any CSS motion exists, add `prefers-reduced-motion: reduce`; otherwise prefer no motion.

5. **Validate before publication**
   - Run the native artifact tool with `action: "validate"` and the intended `runtimeMode`, then fix every error.
   - Treat warnings as a review queue. Resolve them unless they clearly do not apply.
   - Keep source below the validator limit; simplify or compress rather than weakening the gate.

6. **Inspect rendered output**
   - Run `artifact-inspect path/to/artifact.html` for repeatable desktop and phone captures plus horizontal-overflow checks.
   - For deeper interaction or debugging, use agent-browser following its current bundled core instructions.
   - Inspect at least desktop `1440×1000` and phone `390×844`.
   - Check clipping, horizontal overflow, illegible type, broken reading order, empty space, table behavior, and print preview where relevant.
   - Capture screenshots when the artifact is important or a visible revision needs evidence.

7. **Publish intentionally**
   - Publish only after validation and inspection.
   - Update the existing canonical artifact when revising it; do not create duplicate gallery entries.
   - Use `copyUrl: true` only when immediate phone handoff is useful.

## Declarative Interaction

- Counter: a button with `data-artifact-increment="output-id"`; optionally set `data-artifact-step="-1"` or another finite number.
- Toggle: a button with `data-artifact-toggle="panel-id"`; initialize `aria-expanded` and use the target’s `hidden` attribute.
- Tabs: buttons with `data-artifact-show="panel-id"` and a shared `data-artifact-group`; panels use `data-artifact-panel` and the same group.
- Filter: buttons with `data-artifact-filter="category"` and a shared group; items use space-separated `data-artifact-item` categories. Use `*` for all.
- Keep all IDs unique and provide accessible names, selected/expanded state, and a useful initial state before the runtime loads.

## Data Visualization

- State the metric, unit, time window, source, and relevant denominator.
- Use a table when exact lookup matters more than shape; use a chart only when position, trend, distribution, or relationship carries the message.
- Encode the primary comparison with position or length before area or color.
- Use a colorblind-safe categorical palette and reserve the accent for meaning; do not use hue as the only signal.
- Label series and important values directly where possible. Keep axes, baselines, sorting, and truncation honest.
- Pair every chart with a concise textual takeaway and an accessible data table or equivalent values in the document.
- Keep SVG inline, give meaningful graphics a `<title>` and description, and mark decorative graphics hidden from assistive technology.

## Review Checklist

- The opening viewport communicates what this is and why it matters.
- Visual choices encode meaning rather than decoration.
- Every section earns its space; repeated card grids do not replace hierarchy.
- Static artifacts remain useful with scripts blocked; interactive artifacts degrade clearly if scripting is unavailable.
- Interactive documents use only supported declarative behaviors and have no authored code, network, form, worker, popup, external navigation, storage-origin, or parent-page dependency.
- Desktop, phone, keyboard, print, and reduced-motion needs are addressed.
- Canonical and immutable URLs are not confused in explanatory copy.
