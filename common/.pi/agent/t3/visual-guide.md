## T3 Code visuals

Apply this guide whenever you call `html_preview` or `html_render`.

A view is a finished design artifact, not a debug chart. Aim for what a design engineer would ship after a day of work.

**Story first**
- Dig for the finding before you draw: split the data by kind (for commits: hand-written vs automated, area, type), compare periods, and name what caused each spike. "X was the busiest day" is a fact, not a finding.
- Answer the question before you draw. The title is the finding, as one sentence with numbers ("The week of Oct 19 landed 41 commits, 2.3× any other week"), never a label ("Commits over time").
- Under it, one muted line with scope and the key numbers. End with a small caption: data source, method, time zone, partial periods, caveats.
- One view, one idea. Do not default to the dashboard template (eyebrow label, giant headline, KPI tiles, rainbow stacked bars, legend, cards). Get depth from the one view instead: a readout with secondary numbers, a second level of grouping (weeks under days), one or two annotations, and a detail list for the selected item.
- Use real data. Compute it with tools, embed it as JSON in the page, and derive every number in the text from that JSON so text and marks agree.

**Hierarchy and type**
- No outer card, banner, or page padding. Sections are separated by space (24–32px), not boxes. Use a bordered surface only for things that stand for a real object: a window, a panel, a phone, a button.
- Small, calm type: title 14px/500, body 13px, labels 12px, captions 11px; secondary text in --muted-foreground. `font-variant-numeric: tabular-nums` on numbers, --font-mono for code, diffs, and SHAs, `text-wrap: balance` on titles.
- Align everything to one left edge. Use a 4px spacing grid.

**Charts**
- Gray for context, one accent (--chart-1) for the part the title talks about. Semantic colors only for meaning: --success added, --destructive removed, --warning changed. Never rely on hue alone: pair it with position, shape, or a label.
- Direct labels instead of legends. Faint gridlines (`color-mix(in oklab, var(--foreground) 8%, transparent)`), no chart borders, zero baseline for bars. Annotate the one or two points that matter.
- Size SVG in pixels from the container width, not with a scaled viewBox, so text stays 11–12px at 728px and at 360px.

**Make it explorable**
- Pick the most interesting state as the default, so the view reads well without any input.
- Hover, focus, and tap update a fixed readout line above the chart (not a floating tooltip that clips). Add arrow-key navigation and visible focus rings.
- For design exploration, show many distinct options, numbered and named with a one-line trade-off each. Draw them at real size and enlarged, in context (for example above a composer), on each platform asked for. Add segmented controls for scenarios (small/huge data, light/dark, color-vision filters).

**Motion (Emil Kowalski's rules)**
- Animate only to explain a state change: transform and opacity, 150–250ms, `cubic-bezier(0.23, 1, 0.32, 1)`. Never ease-in, never from scale(0), never `transition: all`.
- Readouts that follow the pointer or keys update instantly. Pressable controls get `:active { transform: scale(0.97) }`. Gate hover styles behind `@media (hover: hover) and (pointer: fine)`. Honor `prefers-reduced-motion`.

**Check before you render**
- Call html_preview in dark and light, at 728px and 360px. Look at the PNG as a critic: overlaps, clipped labels, dead space, more than three hues, numbers that do not match. Fix and preview again, then html_render.
