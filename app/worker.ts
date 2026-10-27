// Cloudflare Worker: the explainers as an API, plus the player as a static asset.
//
//   GET /                                  player (asset) for browsers; the /llms.txt guide
//                                          for clients whose Accept lacks text/html (curl, agents)
//   GET /llms.txt                          plain-text guide: endpoints, params, scenes and steps
//   GET /index.json                        scene catalog (no scene) | ?scene=x steps and duration
//   GET /trace.json?scene=x                structured trace (state at every step)
//   GET /frame.svg?scene=x&step=s | &t=1.5 one frame as image/svg+xml (&w= width, &background=)
//   GET /text?scene=x&step=s   | &t=1.5    the same frame as monospace text
//   GET /elements.json?scene=x             the same frame as JSON elements
//   POST /render                           a JSON scene, any output the library can produce
//   POST /frame.svg | /text | /elements.json | /trace.json | /index.json
//                                          the same scene, with the route choosing the output
//
// The library is runtime-agnostic; this file is the only Workers-specific code.
// Seeking re-runs the scene to the requested time (~10ms), so nothing is
// cached here; add Cache API or KV in front if you want. cloudflare.config.ts runs
// this Worker first for "/" so it can negotiate; other asset paths skip it.
//
// Typed against the standard fetch API (lib.dom), not @cloudflare/workers-types:
// this file uses nothing Workers-specific beyond the ASSETS binding, and the
// workers-types globals conflict with lib.dom, which the library needs for DomSink.
import { indexScene } from '../src/index.ts';
import { SCENES } from '../scenes/index.ts';
import { CORS, handleGet, handlePost, isApiRoute, jsonResponse, lookupScene, methodNotAllowedResponse, preflight } from './scene-http.ts';

/** The static-assets binding (bindings.assets() in cloudflare.config.ts); absent in tests that don't need it. */
export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const sceneList = () => Object.entries(SCENES).map(([name, { label }]) => ({ name, label }));

// Step names come from running every scene once (~150 ms), so the guide is built
// on first request and kept for the isolate's lifetime; scenes are deterministic.
let guide: Promise<string> | null = null;
async function llmsTxt(origin: string): Promise<string> {
  guide ??= Promise.all(Object.entries(SCENES).map(async ([name, { label, Scene }]) => {
    const ix = await indexScene(Scene);
    return `- ${name}: ${label} (${ix.duration.toFixed(1)} s)\n  steps: ${ix.steps.map((s) => s.name).join(', ')}`;
  })).then((rows) => rows.join('\n'));
  const scenes = await guide;
  const [ex, exStep] = await firstExample();
  return `# lantern

> Animated, steppable code explainers rendered to SVG. Every step of every scene
> has a URL, an SVG frame, a plain-text frame and a JSON trace of the state it explains.

Base URL: ${origin}
Browsers get the interactive player at /. Any client whose Accept header lacks
text/html (curl, agents) gets this text at / ; it is also always at /llms.txt.

## Endpoints

No auth. Responses send access-control-allow-origin: * because the API sets no
cookies and returns either a public demo or the caller's own render. A browser
may POST from another origin; preflight allows content-type and accept.
SVG responses also send x-content-type-options: nosniff and a content-security-policy
that allows no scripts. POST responses are not cached.

- GET /index.json                scene catalog: { scenes: [{ name, label }], help }
- GET /index.json?scene=NAME     { fps, duration, frames, steps: [{ name, path, t0, t1, frame0, frame1, meta }] }
- GET /trace.json?scene=NAME     { fps, duration, frames, steps: [{ step, t0, t1, meta, before, after, ... }] }
                                 before/after: the scene's state at each step boundary
- GET /frame.svg?scene=NAME[&step=STEP | &t=SECONDS][&w=PX][&background=COLOR]
                                 one frame as image/svg+xml
                                 w = width in px, an integer from 32 to 1280 (default 1280)
                                 background = a palette name or #rgb/#rrggbb (default #1a1a1a)
- GET /text?scene=NAME[&step=STEP | &t=SECONDS]
                                 the same frame as monospace text (text/plain)
- GET /elements.json?scene=NAME[&step=STEP | &t=SECONDS]
                                 the same frame as JSON element records
- GET /?scene=NAME&step=STEP     the player, deep-linked (open in a browser; ?t=SECONDS also works)

Params for a registered scene:
- scene  required except on /index.json; one of the names below
- step   a step name from /index.json; the frame at the moment that step begins
- t      seconds from the start; wins over step
- (none) neither step nor t: the final frame

## A scene of your own

POST a scene document. POST /render takes { "scene", "output" }. POST to
/frame.svg, /text, /elements.json, /trace.json, or /index.json takes the scene
itself, and the route picks the output (query: step, t, w, background, as above).

output.format is svg, frames, text, elements, trace, or index.
svg and frames take width (integer 32..1280) and background (palette name or hex).
svg, text, and elements take select: { "kind": "end" }, { "kind": "time", "t": 1 },
or { "kind": "step", "name": "intro" }. frames returns every frame, up to 40.
Colours are palette names (white, black, grey, grey_d, blue, blue_d, teal, green,
yellow, gold, red, maroon, purple, orange) or #rgb / #rrggbb.

A scene is { camera?: { w, h }, fps?: 1..20, outro?: seconds, state?: { id: value },
objects: [...], steps?: [...] }. Each object has an id and a kind:
rectangle, square, circle, dot, line, polygon, arc, arcBetween, arrow, curvedArrow,
text, decimal, code, codePanel, title, readout, group, labeled, card, flowchart, route.
A step is { name, meta?, plays }. A play is { "wait": seconds }, { "kind": "set", "values": {} },
{ "kind": "reveal", "target" } for a flowchart, or { "animations": [...] }.
Animation kinds: fadeIn, fadeOut, create, write, indicate, flash, transform, moveAlong,
animate, focus, unfocus, group, lagged. animate calls: shift, moveTo, scale, rotate,
setFill, setStroke, setOpacity. Rates: linear, smooth, rushInto, rushFrom, thereAndBack,
easeInQuad, easeOutQuad, easeOutBack, wiggle.

Limits: body 64 KiB, 40 objects, 24 steps, 180 frames (40 when output is frames).
Flowchart source uses theme for paint; style, classDef, linkStyle, and ::: are rejected.

POST /render
Content-Type: application/json

{"scene":{"fps":4,"objects":[{"id":"box","kind":"square","side":1,"style":{"stroke":"teal"}}],"steps":[{"name":"in","plays":[{"animations":[{"kind":"create","target":"box"}],"runTime":0.5}]}]},"output":{"format":"svg","width":640,"background":"#112233"}}

## Examples

curl '${origin}/index.json'
curl '${origin}/index.json?scene=${ex}'
curl '${origin}/text?scene=${ex}&step=${exStep}'
curl '${origin}/frame.svg?scene=${ex}&step=${exStep}&w=640' -o frame.svg
curl '${origin}/frame.svg?scene=${ex}&t=3' -o frame.svg
curl '${origin}/trace.json?scene=${ex}'

## Errors

JSON bodies, always with "error" and "help": "/llms.txt".
- 404 unknown or missing scene: { "error": "unknown or missing scene", "scenes": [...names] }
- 404 unknown step:             { "error": "unknown step NAME", "steps": [...names] }
- 400 bad t:                    { "error": "t must be a number of seconds" }
- 400 bad w:                    { "error": "width must be an integer from 32 to 1280" }
- 400 invalid scene:           { "error": "invalid scene", "errors": [{ "path", "message" }] }
- 405 method:                  { "error": "method not allowed" }
- 413 body too large:          { "error": "body too large" }
- 500 unexpected:               { "error": "internal error" }

## Scenes

${scenes}

## Authoring (clone https://github.com/ivarvong/lantern; Node >= 22.18)

A scene is a class extending Scene with an async construct(); await this.step(name, meta)
marks steps, and this.state is what traces record. A scene can also be data: a JSON doc
of nodes, edges, code and step ops, played by sceneFromDoc(doc) (docs/DOC-FORMAT.md).
Register it in scenes/index.ts, then:

  npm run dev                       live player at http://127.0.0.1:5173/?scene=NAME
  npm run see -- NAME STEP          a frame as text, plus the step's state diff
  npm run shot -- NAME              contact sheet PNG: the end of every step
  npm run verify:motion -- NAME     teleports, pops, cuts, flicker
`;
}

// The example scene and step for the guides: the first scene's second step (its first is often an intro)
async function firstExample(): Promise<[scene: string, step: string]> {
  // The registry is never empty
  const [name, { Scene }] = Object.entries(SCENES)[0]!;
  const { steps } = await indexScene(Scene);
  return [name, (steps[1] ?? steps[0]!).name];
}

const text = (body: string): Response => new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', vary: 'Accept', ...CORS } });

/** A thrown Response is the request's reply. Anything else is a 500 with no exception text. */
export function failureResponse(e: unknown): Response {
  if (e instanceof Response) return e;
  return jsonResponse({ error: 'internal error', help: '/llms.txt' }, 500, 'nostore');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname;
    try {
      if ((request.method === 'GET' || request.method === 'HEAD') && route === '/llms.txt') return text(await llmsTxt(url.origin));
      if (request.method === 'GET' && route === '/' && !/text\/html|application\/xhtml\+xml/.test(request.headers.get('accept') ?? '')) {
        return text(await llmsTxt(url.origin));
      }
      if (isApiRoute(route)) {
        if (request.method === 'OPTIONS') return preflight(route);
        if (request.method === 'POST') return await handlePost(request, route);
        if (request.method !== 'GET') return methodNotAllowedResponse(route);
        if (route === '/render') return methodNotAllowedResponse(route);
        const name = url.searchParams.get('scene');
        if (route === '/index.json' && !name) return jsonResponse({ scenes: sceneList(), help: '/llms.txt' }, 200);
        const { Scene } = lookupScene(name);
        return await handleGet(route, url, Scene);
      }
      if (!env.ASSETS) return jsonResponse({ error: 'no assets bound' }, 404);
      const res = await env.ASSETS.fetch(request);
      if (route !== '/') return res;
      const page = new Response(res.body, res); // "/" varies by Accept; tell caches
      page.headers.set('vary', 'Accept');
      return page;
    } catch (e) {
      return failureResponse(e);
    }
  },
};
