# lantern

Animated, steppable explainers for code changes. A zero-dependency JS port of
manim's core model that renders to SVG: a live DOM in the browser, strings in
Cloudflare Workers or Node. Every step is addressable (`?scene=&step=`), and
every scene has a text form and a structured trace for agents.

## Quickstart

```
git clone https://github.com/ivarvong/lantern && cd lantern   # not on npm yet; zero runtime dependencies
```

Then:

The repo is TypeScript throughout. Node 24 runs the tools and tests as `.ts` directly
(type stripping, so only erasable syntax); `tsc` compiles the library to `dist/`.

```
npm install
npm run dev        # http://127.0.0.1:5173/?scene=pyex-limits, reloads on save, keeps your step
npm test           # ~8 s; FULL=1 (npm run test:full) checks every frame
npm run check      # tsc over every project, emits dist/
```

A scene is a class with an async `construct()`. Steps are markers; `this.state` is
what the explanation is about, and it is what traces record:

```ts
import { Scene, Rectangle, Text, Labeled, Arrow, FadeIn, Create, RIGHT, TEAL, GOLD } from '../src/index.ts';

export class CacheScene extends Scene {
  override async construct() {
    const st = (this.state = { cache: false });

    await this.step('before');
    const handler = new Labeled(new Rectangle({ width: 3, height: 1, stroke: TEAL }), new Text('handler'));
    const db = new Labeled(new Rectangle({ width: 2, height: 1, stroke: GOLD }), new Text('D1'));
    db.nextTo(handler, RIGHT, 2);
    await this.play(new FadeIn(handler), new FadeIn(db));
    await this.play(new Create(new Arrow(handler.shape.right(), db.shape.left(), { buff: 0.1 })));

    await this.step('after', { pr: 482 });
    st.cache = true;
    // ...
  }
}
```

Register it in `scenes/index.ts`, then:

```
npm run see -- my-scene after      # the frame as text, plus the step's state diff
npm run shot -- my-scene           # contact sheet: the end of every step, as a PNG
npm run verify:motion -- my-scene  # teleports, pops, cuts, flicker
```

Diagrams can be text: `flowchart(mermaidSource)` parses a Mermaid flowchart, lays it out
and returns shapes you can animate ([docs/FLOWCHART.md](docs/FLOWCHART.md)). Scenes can also be
data: `sceneFromDoc(doc)` plays a JSON document of nodes, edges,
code and ops ([docs/DOC-FORMAT.md](docs/DOC-FORMAT.md)).

## Model

- A **Mobject** is a tree of `Float32Array` point buffers (stride 2) plus a style record.
  Every geometric operation maps a function over the family's points: points are the truth.
- A **VMobject** is a list of cubic Bézier subpaths `[anchor, (h1, h2, anchor)*]`, so curve
  *n* starts at point *3n*. The serializer and the alignment code share that one contract.
- **Text** is glyph outlines (Inter, JetBrains Mono, embedded), one VMobject per glyph: exact
  advances, letter-by-letter `Write`, and `Transform` between strings morphs glyph to glyph.
  Nothing depends on installed fonts, so every rasterizer draws the same thing.
- An **Animation** is a pure function of alpha over two endpoints fixed in `begin()`.
  `Transform` first aligns structure (null copies, de Casteljau subdivision) so both ends
  have equal shape; each frame is then a lerp, field by field, style included.
- A **Scene** advances a fixed `dt = 1/fps` and hands itself to a **sink**, which decides
  what a frame is: `StringSink` collects SVG, `DomSink` patches a live `<svg>` on rAF time,
  `MotionSink` samples boxes for the verifier, `TraceSink` records state at step boundaries.
  Output is deterministic.
- **Seeking** re-runs the scene to `t` with frames skipped (manim's `skip_animations`): the
  loop is fixed-dt and the endpoints are fixed at `begin()`, so a seek is byte-identical to a
  full run. Tests assert this for every scene.

Coordinates are manim's: the frame is 16 × 9 units, origin at the center, **y up**
(`UP = [0, 1]`, angles counterclockwise). The flip to SVG's y-down happens in one place,
where path data is written (`VMobject.roundedRelative`).

## Layout

```
src/        the library: no dependencies, no runtime assumptions (browser, Workers, Node)
  index.ts    the public API, curated, types included; anything not exported here is internal
dist/       src/ compiled by tsc: ESM .js, .d.ts, maps. What the package exports (npm run build:lib)
scenes/     example scenes and the registry (index.ts)
app/        the player (player.ts, DomSink) and the Worker (worker.ts): the only runtime-specific code
tools/      dev server, build, inspection, verifiers, perf tools (Node; Chromium via playwright-core)
test/       node --test; golden-traces.json hashes each scene's trace (UPDATE_GOLDEN=1 to bless)
vendor/     the glyph shaper bundle (tools/vendor-glyph.ts), its types, and glyph.pin.json (sha256, checked in CI)
docs/       PERF.md, VERIFY.md, DOC-FORMAT.md
```

## Outputs

| | how |
|---|---|
| live, in a page | `app/player.ts`: `?scene=&step=` deep links, step mode, copy link |
| one frame as SVG | `renderAt(Scene, t, new SnapshotSink({ width, background }))`, Worker `GET /frame.svg`, or `POST /render` |
| one frame as text | `renderText(scene)`, `npm run see`, or Worker `GET /text` |
| one frame as elements | `renderElements(scene)`, or Worker `GET /elements.json` |
| state at every step | `traceScene(Scene)`, or Worker `GET /trace.json` |
| steps and duration | `indexScene(Scene)`, or Worker `GET /index.json` |
| every frame | `new StringSink({ width, background })`, Worker `POST /render` with `"format": "frames"`, or `npm run render` |

Deploy: `npm run deploy` (builds `out/site/`, then `cf deploy`). `npm run worker:dry-run` builds and validates the Worker without credentials or an upload; `npm run worker:dev` serves the Worker and player locally with `cf dev`. Worker settings live in `cloudflare.config.ts`; `vite.config.ts` points the static assets at `out/site/`.

## HTTP API

The Worker in `app/` exposes the library. A registered demo is a GET. A scene you describe in JSON is a POST, and it can use the same shapes, animations, and outputs as a class in TypeScript. The browser player (`DomSink`) is the live view; HTTP returns strings.

`POST /render` takes `{ "scene", "output" }`. `POST /frame.svg`, `/text`, `/elements.json`, `/trace.json`, and `/index.json` take the scene itself, and the path chooses the output. Query `step`, `t`, `w`, and `background` work on those shortcuts the same way they do on a GET.

```json
{
  "scene": {
    "fps": 4,
    "objects": [
      { "id": "box", "kind": "square", "side": 1.4, "style": { "stroke": "teal", "fill": "teal", "fillOpacity": 0.15 } },
      { "id": "label", "kind": "text", "text": "cache", "fontSize": 0.35 }
    ],
    "steps": [
      { "name": "in", "plays": [{ "animations": [{ "kind": "fadeIn", "target": "box" }, { "kind": "write", "target": "label" }], "runTime": 0.5 }] }
    ]
  },
  "output": { "format": "svg", "width": 640, "background": "#112233", "select": { "kind": "end" } }
}
```

`output.format` is `svg`, `frames`, `text`, `elements`, `trace`, or `index`. `svg` and `frames` take `width` (an integer from 32 to 1280, default 1280) and `background` (default `#1a1a1a`). Those are the `SvgOptions` fields. The serializer itself accepts an integer width from 1 to 4096 and a `#rgb` or `#rrggbb` background, and rejects any other value before it is written. `svg`, `text`, and `elements` take `select`: `{ "kind": "end" }`, `{ "kind": "time", "t": 1.5 }`, or `{ "kind": "step", "name": "in" }`. `frames` returns every frame, up to 40. `trace` and `index` describe the whole scene.

A colour is a palette name (`white`, `black`, `grey`, `grey_d`, `blue`, `blue_d`, `teal`, `green`, `yellow`, `gold`, `red`, `maroon`, `purple`, `orange`) or `#rgb` / `#rrggbb`. `none` is a paint, not a background. Object kinds are `rectangle`, `square`, `circle`, `dot`, `line`, `polygon`, `arc`, `arcBetween`, `arrow`, `curvedArrow`, `text`, `decimal`, `code`, `codePanel`, `title`, `readout`, `group`, `labeled`, `card`, `flowchart`, and `route`. Animation kinds are `fadeIn`, `fadeOut`, `create`, `write`, `indicate`, `flash`, `transform`, `moveAlong`, `animate`, `focus`, `unfocus`, `group`, and `lagged`. An `animate` call is `shift`, `moveTo`, `scale`, `rotate`, `setFill`, `setStroke`, or `setOpacity`. Rates are `linear`, `smooth`, `rushInto`, `rushFrom`, `thereAndBack`, `easeInQuad`, `easeOutQuad`, `easeOutBack`, and `wiggle`.

Flowchart paint comes from `theme`. The source must not use `style`, `classDef`, `linkStyle`, or `:::`.

The body is at most 64 KiB. A scene has at most 40 objects, 24 steps, and 180 frames (40 when the output is `frames`). A request that fails those checks is a 400 `{ "error", "errors": [{ "path", "message" }], "help": "/llms.txt" }`. An unknown demo is a 404. A body over the limit is a 413.

Responses send `access-control-allow-origin: *`. The API is unauthenticated and sets no cookies; a response is a public demo or the caller's own render, so any origin may read it. Preflight allows `content-type` and `accept`. SVG responses also send `x-content-type-options: nosniff` and `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'none'`. POST responses are `no-store`. GET frames from the registry stay `public, max-age=3600`.

`GET /llms.txt` is the same contract, with the demo names and their steps.

## Commands

| | |
|---|---|
| `npm run dev` | source tree as native ES modules on 127.0.0.1, live reload |
| `npm run build` | single-file player pages in `out/` (esbuild, ~80 ms) |
| `npm test` / `test:full` | sampled frames / every frame |
| `npm run check` | `tsc -b` over every project (library, app, tools and tests), emit `dist/`, compile a TypeScript consumer against it |
| `npm run build:lib` | `dist/` from scratch; `prepack` runs it |
| `npm run verify` | motion verifier, then the playback gate in Chromium ([docs/VERIFY.md](docs/VERIFY.md)) |
| `npm run bench` | every scene timed against `bench/baseline.json`; fails on a reproduced regression |
| `MANIM_DIR=… npm test` | also diffs rate functions and curve subdivision against manim's own code |
| `npm run see`, `shot`, `render` | look at a scene: text, contact sheet, SVG frames |
| `npm run trace`, `profile`, `seek`, `ab`, `hitch` | performance ([docs/PERF.md](docs/PERF.md)) |
| `npm run fonts` | re-subset the embedded fonts (needs `pip install fonttools brotli`) |

## Out of scope, for now

- Matching morphs (`TransformMatchingShapes`): glyphs pair by index, not by shape.
- 3D, boolean path ops, LaTeX.
- Rigid moves as SVG `transform` attributes: every move rewrites points.
- Collaboration: the trace and doc formats are diffable, but nothing syncs them yet.
