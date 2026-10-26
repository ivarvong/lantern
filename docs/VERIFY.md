# Verifying

"It looks jumpy" has three different causes, and each needs its own check:
something moved wrong (motion), frames arrived late (pacing), or the page moved
under the animation (layout).

`npm test` covers fidelity and correctness. `npm run verify` runs the motion verifier,
then the playback gate.

## Fidelity: is it true? (npm test)

Everything else on this page is self-consistency. A scene that animates the wrong
answer, smoothly and deterministically, passes all of it. Two checks compare against
something outside the project:

**The program.** `test/fidelity.test.ts` runs a reference implementation of the code
each scene explains (the code shown on screen, as a real function), replays the trace's
step inputs (`meta`) through it, and requires the state the scene shows (`after`) at
every step. Covered: token-bucket, ring-buffer, state-machine. Mutation-checked: an
off-by-one in a scene's refill arithmetic fails the test at the first step it shows.

Not covered: **pyex-limits**. Its program is Elixir and there is no runtime here, so its
numbers come from reading `ctx.ex`. One claim is probably off: the scene charges one
allocation (8064 bytes) per `xs.append([0] * 1000)`, while the interpreter also
allocates the `[0]` literal and charges the growth of `xs` on append (`heap_put`'s
`delta`), so the shown 24192 after three iterations is likely low by a few hundred
bytes. The limit still trips on the same iteration. Running the scene's program through
real pyex and comparing is the open item.

**manim.** `test/manim.test.ts` runs manim's own functions, extracted by name from a
pinned checkout (`tools/oracle/manim_math.py`, `MANIM_DIR`), and compares: rate
functions at 101 points (1e-12), cubic splitting against `partial_bezier_points`, and
how extra curves are distributed over a path against `insert_n_curves_to_point_list`.
That last one found a divergence: we spread new curves evenly by count, manim cuts by
length so the longest piece anywhere is as short as it can be. Ours now follows
manim's rule (`distributeCurves`); where manim's choice is a tie (equal `L / j`), the
test checks the objective rather than the arbitrary pick. Visible effect in the example
scenes: intermediate morph shapes move by up to 0.24 units; endpoints are unchanged.

## Correctness (npm test)

- **Random scenes** (`test/property.test.ts`): scenes built from a seed, with random
  shapes, groups, text and animations, must be deterministic and finite, keep every
  path cache and `box()` exact at every frame, seek byte-for-byte to any time, land
  each `Transform` exactly on its target leaf by leaf, and preserve geometry under
  subdivision. 40 seeds by default, 400 with `FULL=1`; `SEED=n` reruns one. This is
  where the engine bugs were: two animations driving one mobject in a play (now an
  error), a path morphing into a group (crash) or a Text (blended against the advance
  box), a seek that differed from the full run by a Float32 ulp that alignment then
  amplified, an open path morphing into a closed one and staying open, and
  `a + (b - a) * 1 ≠ b`.
- **Bare runtime** (`test/runtime.test.ts`): the library and every scene, bundled, run
  in a `vm` context with only ECMAScript globals plus `TextEncoder`, `TextDecoder` and
  `atob` (what Workers provide). No `setTimeout`, `console`, `process` or DOM.
- **No leaks** (`test/leak.test.ts`): 50 seeks and traces leave the heap where 10 did
  (flat at ~9.5 MB on pyex-limits).
- **API surface** (`test/api.test.ts`): the exact set of exported names, and the
  coordinate convention.
- **Consumer types** (`npm run check`): `test/consumer/consumer.ts` compiles against the
  emitted declarations in `dist/`, imported as `manim-js`; a wrong option type fails it.
- **Determinism**: the same scene renders the same frames.
- **Seek equals full run**: a seek to any step, or any time, renders the byte-identical
  frame a full run produces, in every scene; skipping frames changes no trace.
- **Caches are never stale**: every scene, every sampled frame (`FULL=1`: every frame),
  with `VMobject.validateCaches` re-checking each cache hit; cached output equals
  uncached output.
- **Golden traces**: each scene's trace (step boundaries, meta, state before and after)
  is hashed in `test/golden-traces.json`. A behavior change shows up as a hash diff;
  `UPDATE_GOLDEN=1 npm test` blesses it after you have looked at `npm run see`.
- **Docs in sync**: `scenes/ring-buffer.doc.json` must equal what its generator produces.

## Motion (npm run verify:motion)

`MotionSink` samples every drawn leaf each frame (its box and effective alpha);
`analyzeMotion` reports:

| event | meaning |
|---|---|
| teleport / resize | position or size changes ≥ 0.2 units in one frame *and* ≥ 3× the change on either side (a spike, not a fast move) |
| pop | effective alpha changes ≥ 0.5 in one frame |
| cut-in / cut-out | a leaf appears or vanishes already mostly opaque |
| flicker | a leaf vanishes and returns within 3 frames |
| handoff | a replacement lands somewhere other than what it replaced |
| ghost | two texts overlap while both opacities are between 0.12 and 0.88 (a crossfade; outgoing text must finish before the next text starts) |
| overflow | a label whose center lies inside its shape extends more than 0.04 past that shape (text is centered on its advance box, so a label no longer needs a hand-tuned baseline offset) |
| pierce | a connector (a line, a polyline, or an open arc) crosses a glyph run or comes within 0.05 of one, or enters a box or another connector's arc, anywhere but its own two ends. A stair of short pieces is one connector; the end pad does not apply to the joints |
| fill | a bare rectangle's text sits in one corner of it. A `Labeled` shape is exempt: its label is placed by the layout, centered or pinned as a title. A cluster that holds other boxes is exempt |
| overlap | two resting texts, or a text and a box, or two boxes, occupy the same space. Containment is a layout, not a collision. `allowOverlap` declares a deliberate exception |
| margin | two resting texts in a column are closer than 0.03. Glyphs that abut on one baseline are a line, not a crush |
| intrude | a moving text that belongs to no box crosses a label inside a rectangle. A value landing in an empty slot is that slot. A token flying through a card's rows is not |

A `Text` is tracked as one unit: its glyphs are rebuilt when the string changes, so
per-glyph identity means nothing there. Each event names the step, time and leaf
(`Glyph#8 in Text "pyex #29 …"`, or `Text#12 "29"`).

The detector is calibrated in `test/verify.test.ts`: silent on smooth shifts, fast
linear moves, fades, morphs and draw-ins; firing on known teleports, cuts and pops.
The same file asserts every example scene is clean.

What it found in the examples, all fixed:
- `MoveAlongPath` snapped tokens onto edges that start at a box's border. It now blends
  in from the current position (`{ fromCurrent: false }` gives manim's snap).
- `Create` left fill-only glyphs invisible until the fill popped in. It now draws a
  border in the fill color first.
- Two elements were `add()`ed without a fade.

## Playback (npm run verify:playback)

Plays each scene to the end in Chromium and reads the presentation time of every frame
plus the browser's own long-task and layout-shift entries. It gates at 1× CPU:
- late frames (≥ 50 ms apart) ≤ max(1%, 3 frames);
- playback speed within 1% of realtime;
- no layout shift after load.

`--cpu=4` is reported, not gated. The gate runs locally, not in CI: shared runners are
too noisy for this budget.

What it found:
- The pacing loop (`setTimeout`, then `requestAnimationFrame`, decided on
  `performance.now()`) alternated 16/50 ms intervals whenever a frame's due time sat
  near a vsync boundary. `DomSink` now schedules on rAF timestamps against a wall-clock
  anchor, patches inside the frame it is due in, and drops a late frame's DOM patch
  rather than slowing down, never freezing more than 100 ms.
- A long state diff grew a scrollbar mid-playback. The gutter is now reserved.

| | before | after |
|---|---|---|
| pyex-limits, 1×: frames ≥ 50 ms apart | 1.4% | 0% |
| state-machine, 4× | 3.9% | 0.2% |
| token-bucket, 4× | 2.9% | 0% |
| interval p95, 1× | 46–49 ms | 33.4 ms |

## Looking

Automated checks miss layout. Before merging a scene change, run `npm run shot --
<scene>`: it renders the end of every step into one PNG.
