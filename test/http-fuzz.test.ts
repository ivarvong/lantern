// The HTTP scene API, end to end: hostile requests stay JSON errors, and every
// SVG that comes back parses as a closed set of elements and attributes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../app/worker.ts';
import { rng } from './lib/random-scene.ts';
import { assertSvg as checkSvg } from './lib/svg-oracle.ts';

const ORIGIN = 'https://lantern.example';
const env = { ASSETS: { fetch: async () => new Response('page', { headers: { 'content-type': 'text/html' } }) } };

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(ORIGIN + path, init), env);
}

function bytes(body: Uint8Array): Blob {
  const copy = new ArrayBuffer(body.byteLength);
  new Uint8Array(copy).set(body);
  return new Blob([copy]);
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const payload: BodyInit = typeof body === 'string' ? body : body instanceof Uint8Array ? bytes(body) : JSON.stringify(body);
  return call(path, { method: 'POST', body: payload, headers: { 'content-type': 'application/json', ...headers } });
}

function assertSvg(svg: string, background: string, width: number): void {
  checkSvg(svg, { width, background, paints: 'hex' });
}

async function assertRejected(res: Promise<Response> | Response, status: number): Promise<string> {
  const got = await res;
  const text = await got.text();
  assert.equal(got.status, status, text);
  assert.match(got.headers.get('content-type') ?? '', /json/);
  assert.equal(text.toLowerCase().includes('<script'), false, text);
  const body = JSON.parse(text) as { error?: string; help?: string };
  assert.equal(typeof body.error, 'string');
  assert.equal(body.help, '/llms.txt');
  return text;
}

test('registered SVG frames carry the security headers and the requested paint', async () => {
  const res = await call('/frame.svg?scene=token-bucket&t=0&background=%23abcdef&w=200');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'none'/);
  assert.match(res.headers.get('cache-control') ?? '', /public/);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
  assertSvg(await res.text(), '#abcdef', 200);
});

test('prototype scene names are a 404, and a long name is a 400 that does not echo it', async () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const res = await call('/frame.svg?scene=' + name);
    assert.equal(res.status, 404, name);
    assert.match((await res.text()), /unknown or missing scene/);
  }
  const long = 'a'.repeat(65);
  const body = await assertRejected(call('/text?scene=' + long), 400);
  assert.equal(body.includes(long), false);
});

test('hostile scene documents fail closed', async () => {
  const attacks: unknown[] = [
    { scene: { objects: [{ id: 'a', kind: 'dot' }] }, output: { format: 'svg', background: '</rect><script>alert(1)</script>', width: 200 } },
    { scene: { objects: [{ id: 'a', kind: 'dot' }] }, output: { format: 'svg', width: '1280" onload="alert(1)' } },
    { scene: { objects: [{ id: 'a', kind: 'dot', color: 'constructor' }] }, output: { format: 'svg' } },
    { scene: { objects: [{ id: 'a', kind: 'text', text: 'a\u0000b' }] } },
    { scene: { objects: [{ id: 'a', kind: 'flowchart', source: 'flowchart LR\nstyle A fill:#fff' }] } },
    { scene: { objects: [{ id: '__proto__', kind: 'dot' }] } },
    { scene: { objects: [{ id: 'a', kind: 'constructor' }] } },
    null,
    [],
    { scene: { objects: [{ id: 'a', kind: 'dot' }], extra: true } },
  ];
  for (const body of attacks) await assertRejected(post('/render', body), 400);
  await assertRejected(post('/render', 'x'.repeat(70_000)), 413);
  await assertRejected(post('/render', new Uint8Array([0xff, 0xfe, 0x00])), 400);
  await assertRejected(call('/frame.svg?scene=lantern&w=wide'), 400);
  await assertRejected(call('/frame.svg?scene=lantern&w=10'), 400);
  await assertRejected(call('/render'), 405);
});

test('text that looks like markup stays inside the svg', async () => {
  const res = await post('/frame.svg?w=320&background=%23abcdef', {
    fps: 4,
    objects: [{ id: 'a', kind: 'text', text: '</svg><script>alert(1)</script>', fontSize: 0.4, color: '#abc' }],
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const svg = await res.text();
  assert.equal(svg.includes('<script'), false);
  assertSvg(svg, '#abcdef', 320);
});

test('a flowchart label cannot add an element', async () => {
  const res = await post('/frame.svg?w=400&background=%23111111', {
    fps: 4,
    objects: [{ id: 'f', kind: 'flowchart', source: 'flowchart LR\nA["</svg><script>alert(1)</script>"]', width: 6, height: 2, fontSize: 0.2 }],
  });
  assert.equal(res.status, 200, await res.clone().text());
  const svg = await res.text();
  assert.equal(svg.includes('<script'), false);
  assertSvg(svg, '#111111', 400);
});

test('preflight allows POST without credentials', async () => {
  const res = await call('/render', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /content-type/);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

const KINDS = {
  fps: 4,
  camera: { w: 16, h: 9 },
  state: { n: 1 },
  objects: [
    { id: 'rect', kind: 'rectangle', at: [-5, 2], width: 1.2, height: 0.7, style: { fill: 'blue', stroke: 'white' } },
    { id: 'sq', kind: 'square', at: [-3, 2], side: 0.7, style: { fill: '#abc' } },
    { id: 'circ', kind: 'circle', at: [-1.5, 2], radius: 0.35, style: { stroke: 'teal' } },
    { id: 'dot', kind: 'dot', at: [0, 2], color: 'gold' },
    { id: 'ln', kind: 'line', start: [-5, 0.4], end: [-3, 0.4], style: { stroke: 'green' } },
    { id: 'poly', kind: 'polygon', at: [-1, 0.2], points: [[0, 0], [0.5, 0], [0.2, 0.4]], style: { fill: 'purple' } },
    { id: 'arc', kind: 'arc', at: [1, 0.4], radius: 0.35, angle: 2 },
    { id: 'arcb', kind: 'arcBetween', start: [2, 0.2], end: [3, 0.6] },
    { id: 'arr', kind: 'arrow', start: [-5, -0.8], end: [-3.4, -0.8], stroke: 'red' },
    { id: 'carr', kind: 'curvedArrow', start: [-2, -1], end: [-0.4, -0.6], stroke: 'orange' },
    { id: 'tx', kind: 'text', at: [1.5, -0.8], text: 'hi', fontSize: 0.3, font: 'mono' },
    { id: 'dec', kind: 'decimal', at: [3, -0.8], value: 2, decimals: 1, fontSize: 0.28 },
    { id: 'code', kind: 'code', at: [-5.5, -2.2], lines: ['a = 1'], fontSize: 0.22 },
    { id: 'panel', kind: 'codePanel', at: [-3, -2.2], lines: ['one', 'two'], fontSize: 0.22 },
    { id: 'ttl', kind: 'title', text: 'Demo' },
    { id: 'ro', kind: 'readout', at: [4.5, -2.2], entries: [['n', 1]], fontSize: 0.24 },
    { id: 'gchild', kind: 'circle', radius: 0.18, style: { fill: 'yellow' } },
    { id: 'grp', kind: 'group', at: [-6.2, 3], children: ['gchild'] },
    { id: 'labShape', kind: 'square', side: 0.6, style: { stroke: 'maroon' } },
    { id: 'labText', kind: 'text', text: 'L', fontSize: 0.24 },
    { id: 'lab', kind: 'labeled', at: [5.5, 2], shape: 'labShape', label: 'labText' },
    { id: 'card', kind: 'card', at: [5.5, -0.2], rows: ['row'], fontSize: 0.24 },
    { id: 'flow', kind: 'flowchart', at: [0, 3.3], source: 'flowchart LR\nA-->B', width: 3, height: 1, fontSize: 0.18 },
    { id: 'fromBox', kind: 'rectangle', at: [-6, -3.3], width: 0.9, height: 0.5, style: { stroke: 'grey' } },
    { id: 'toBox', kind: 'rectangle', at: [-4.2, -3.3], width: 0.9, height: 0.5, style: { stroke: 'grey' } },
    { id: 'wire', kind: 'route', from: 'fromBox', to: 'toBox', stroke: 'grey' },
  ],
  steps: [
    { name: 'in', plays: [{ animations: [
      { kind: 'fadeIn', target: 'rect', rate: 'smooth' },
      { kind: 'create', target: 'circ' },
      { kind: 'write', target: 'tx' },
      { kind: 'indicate', target: 'sq', color: 'gold' },
      { kind: 'flash', target: 'dot' },
    ], runTime: 0.25 }] },
    { name: 'move', meta: { caption: 'go' }, plays: [
      { kind: 'set', values: { n: 2 } },
      { animations: [
        { kind: 'moveAlong', target: 'dot', path: 'ln' },
        { kind: 'fadeOut', target: 'poly' },
        { kind: 'focus', target: 'panel', line: 1 },
        { kind: 'transform', target: 'sq', to: { kind: 'circle', radius: 0.3 }, replace: false },
      ], runTime: 0.25 },
      { kind: 'reveal', target: 'flow', runTime: 0.25 },
      { animations: [
        { kind: 'group', animations: [{ kind: 'unfocus', target: 'panel' }, { kind: 'create', target: 'arr' }] },
        { kind: 'lagged', animations: [{ kind: 'fadeIn', target: 'card' }, { kind: 'write', target: 'ttl' }] },
        { kind: 'animate', target: 'dec', calls: [{ method: 'shift', by: [0.1, 0] }, { method: 'setFill', fill: 'teal' }] },
      ], runTime: 0.25 },
    ] },
  ],
};

test('one scene exercises every kind and every output', async () => {
  const svg = await post('/render', { scene: KINDS, output: { format: 'svg', width: 480, background: 'black', select: { kind: 'step', name: 'in' } } });
  assert.equal(svg.status, 200, await svg.clone().text());
  assertSvg(await svg.text(), '#000000', 480);
  const text = await post('/text?step=move', KINDS);
  assert.equal(text.status, 200, await text.clone().text());
  assert.match(text.headers.get('content-type') ?? '', /text\/plain/);
  assert.ok((await text.text()).length > 0);
  const elements = await post('/elements.json', KINDS);
  assert.equal(elements.status, 200);
  const records = await elements.json() as Array<{ tag: string }>;
  assert.ok(Array.isArray(records) && records.length > 0);
  assert.ok(records.every((r) => r.tag === 'path'));
  const trace = await post('/trace.json', KINDS);
  assert.equal(trace.status, 200, await trace.clone().text());
  const traced = await trace.json() as { steps: Array<{ step: string; after?: { n?: number } }> };
  assert.deepEqual(traced.steps.map((s) => s.step), ['in', 'move']);
  assert.equal(traced.steps[1]?.after?.n, 2);
  const index = await post('/index.json', KINDS);
  assert.equal(index.status, 200);
  const indexed = await index.json() as { steps: Array<{ name: string }> };
  assert.deepEqual(indexed.steps.map((s) => s.name), ['in', 'move']);
  const frames = await post('/render', { scene: KINDS, output: { format: 'frames', width: 200, background: '#abcdef' } });
  assert.equal(frames.status, 200, await frames.clone().text());
  const packed = await frames.json() as { frames: string[] };
  assert.ok(packed.frames.length > 1 && packed.frames.length <= 40);
  assertSvg(packed.frames[0]!, '#abcdef', 200);
});

test('random scenes render to strict svg', async () => {
  const colors = ['white', 'blue', 'teal', 'gold', '#abc', '#123456'];
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed);
    const n = r.int(1, 3);
    const objects = Array.from({ length: n }, (_, i) => {
      const id = `m${i}`;
      const at = [Math.round(r(-3, 3) * 10) / 10, Math.round(r(-2, 2) * 10) / 10];
      switch (r.int(0, 4)) {
        case 0: return { id, kind: 'rectangle', at, width: 0.8, height: 0.5, style: { fill: r.pick(colors), stroke: 'white' } };
        case 1: return { id, kind: 'circle', at, radius: 0.3, style: { stroke: r.pick(colors) } };
        case 2: return { id, kind: 'square', at, side: 0.6, style: { fill: r.pick(colors) } };
        case 3: return { id, kind: 'dot', at, color: 'gold' };
        default: return { id, kind: 'text', at, text: r.pick(['a', 'hi', 'x = 1']), fontSize: 0.3, font: r.bool() ? 'mono' : 'sans' };
      }
    });
    const scene = {
      fps: 4,
      objects,
      steps: [{ name: 's', plays: [{ animations: [{ kind: 'fadeIn', target: 'm0' }], runTime: 0.25 }] }],
    };
    const res = await post('/frame.svg?w=200&background=%23abcdef', scene);
    assert.equal(res.status, 200, `seed ${seed}: ${await res.clone().text()}`);
    assertSvg(await res.text(), '#abcdef', 200);
  }
});
