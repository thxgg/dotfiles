# Local pi-centered adaptation

Source: https://github.com/ChmaraX/pi-centered

Base: npm `pi-centered@0.1.0`, commit
`b1722b0e56256ba4f27c5d65b383b6e0444952fe`.
The original MIT license is retained in `LICENSE`.

`../../extensions/pi-centered.ts` loads this copy. Do not also install the npm
extension: both versions register `/maxwidth` and change the same components.
The saved width and `PI_CENTERED_WIDTH` override remain compatible with upstream.

## Local changes

- Center each rendered Mermaid diagram independently of the text column.
- Use the actual terminal content width, including Markdown padding and the
  fullscreen scrollbar, to decide whether a diagram fits.
- Keep oversized or non-rendering Mermaid blocks inside the normal text column.
- Re-evaluate the split on terminal resize, content change, and invalidation.
- Isolate Pi's private Markdown fields behind a typed compatibility boundary.
- Keep centering active during runtime replacement. Install base layout before
  awaiting Mermaid. Once-per-process wrappers around `AgentSession.reload` and
  `AgentSessionRuntime` replacement methods clear the old layout if no new
  centered session starts. Cancelled switches retain it; quit clears it.
  These wrappers remain inert when centering is removed. Pi upgrades must verify
  these lifecycle boundaries as well as the component rendering internals.

This remains a TUI-internal workaround, tested against Pi 1.4.0. It affects only
rendering, not model context or saved messages. Only top-level Mermaid blocks
participate, matching Pi's own Mermaid transform. `/maxwidth off` restores native
full-width rendering, including native diagram alignment.

The entry point resolves its repository source before importing this module, so
one Stow leaf link is sufficient. The upstream global hook keys are retained so
an already-open session can switch to this implementation on `/reload`.

## Validation

From `common/.pi`:

```sh
node --import tsx --test test/centered-{layout,lifecycle}.test.mjs
npm run check
```

The regression tests use real Pi Markdown, assistant message components, Mermaid
transforms, and fullscreen scroll-width calculation. They cover fit boundaries,
source fallback, mixed blocks, small diagrams, resize, rendering modes, reload,
and `/maxwidth off`. Lifecycle tests use real Pi SDK replacement operations and
check delayed loading, resizing, cancellation, removal, failed loads, and quit.
They make no model calls. Visual selection/copy, IME, and
terminal-protocol image rendering still need interactive verification.
