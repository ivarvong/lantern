# Changelog

## Unreleased

- Layout: `Card` sizes a box to its rows, and `route` draws a connector that meets an edge
  without crossing text or another box. `verify:motion` rejects a frame that breaks
  those rules (`pierce`, `fill`, `overlap`, `margin`, `intrude`). `intrude` is a text
  sitting inside a box it is not part of, including mid-flight.
- TypeScript: the library, scenes, player, Worker, tools and tests are strict TypeScript.
  The package ships `dist/` (ESM, `.d.ts`, declaration maps) compiled by `tsc`; option,
  document and trace types (`Doc`, `TextOpts`, `StepRecord`, ...) are exported from the
  package root. Rendered output (SVG, text, traces) is byte-identical.

## 0.1.0

First release. A zero-dependency port of manim's core model to JavaScript, rendering
to SVG: a live DOM in the browser, strings in Cloudflare Workers or Node.

- Model: Mobject trees of typed point buffers; VMobject cubic Bézier paths; Text as
  glyph outlines (Inter, JetBrains Mono embedded); Transform with manim's alignment
  and curve distribution; FadeIn/Out, Create, Write, Indicate, Flash, MoveAlongPath,
  LaggedStart; `.animate` builder. Coordinates are manim's (y up).
- Scenes: async `construct()`, named steps with meta and captions, `this.state` traced
  at step boundaries, seeking by re-running with frames skipped (byte-identical to a
  full run), a JSON document format (`sceneFromDoc`).
- Output: SVG strings, a DOM sink paced on rAF timestamps, a text renderer for agents,
  structured traces.
- Verified: determinism, seek equality, cache validation, 400-seed property tests,
  fidelity oracles (reference programs, the real git CLI, manim's own functions),
  motion and playback gates, bare-runtime and leak tests, a pinned API surface.
