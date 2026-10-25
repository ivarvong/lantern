import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Rectangle, Circle, Text, Labeled, FadeIn, FadeOut, Transform, Create, MoveAlongPath, Line, MotionSink, analyzeMotion, linear, RIGHT } from '../src/index.ts';
import type { MoveAlongPathOpts } from '../src/index.ts';

// Caption holds are thousands of identical frames; the hold rule has its own test
Scene.captionWpm = Infinity;

const run = async (body: (s: Scene) => Promise<void>): Promise<string[]> => {
  const sink = new MotionSink();
  const s = new Scene(sink, { fps: 30 });
  s.construct = async function (this: Scene) { await body(this); };
  await s.run();
  return analyzeMotion(sink).map((e) => e.kind);
};

test('quiet on smooth motion: shifts, fades, morphs, draw-ins, fast linear moves', async () => {
  assert.deepEqual(await run(async (s) => {
    const r = new Rectangle();
    await s.play(new FadeIn(r));
    await s.play(r.animate.shift([5, 0]), { runTime: 0.5 });          // fast but smooth
    await s.play(r.animate.shift([-5, 0]), { runTime: 0.5, rateFunc: linear });
    await s.play(new Transform(r, new Circle({ radius: 1 }).shift([1, 1])));
    await s.play(new Create(new Line([-3, 2], [3, 2])));
    await s.play(new FadeOut(r));
  }), []);
});

test('flags a teleport between plays', async () => {
  const kinds = await run(async (s) => {
    const r = new Rectangle(); await s.play(new FadeIn(r));
    r.shift([3, 0]);                                   // no animation: jumps on the next frame
    await s.wait(0.3);
  });
  assert.deepEqual(kinds, ['teleport']);
});

test('MoveAlongPath from off the path: snapping is a teleport, the default blends in', async () => {
  const ride = (opts: MoveAlongPathOpts) => run(async (s) => {
    const r = new Rectangle({ width: 0.5, height: 0.5 }); await s.play(new FadeIn(r));
    await s.play(new MoveAlongPath(r, new Line([4, 2], [6, 2]), opts));  // path starts far from r
  });
  assert.ok((await ride({ fromCurrent: false })).includes('teleport'), 'manim-style snap is flagged');
  assert.deepEqual(await ride({}), [], 'default starts where the mobject is');
});

test('flags hard cuts and pops, not fades', async () => {
  const kinds = await run(async (s) => {
    const r = new Rectangle(); await s.play(new FadeIn(r));
    s.add(new Circle()); await s.wait(0.2);            // cut-in
    s.remove(r); await s.wait(0.2);                    // cut-out
  });
  assert.deepEqual(kinds, ['cut-in', 'cut-out']);
});

test('a ReplacementTransform onto a matching target is a seamless handoff', async () => {
  const kinds = await run(async (s) => {
    const a = new Rectangle(); await s.play(new FadeIn(a));
    await s.play(new Transform(a, new Rectangle().shift(RIGHT), { replace: true }));
    await s.wait(0.2);
  });
  assert.deepEqual(kinds, []);
});

test('thin shapes hand off cleanly (zero-height boxes)', async () => {
  const kinds = await run(async (s) => {
    const l = new Line([-3, 0], [3, 0]); await s.play(new Create(l));
    await s.play(new Transform(l, new Line([-3, 0], [2, 0]), { replace: true }));
    await s.wait(0.2);
  });
  assert.deepEqual(kinds, []);
});

test('a left-anchored counter changing digit count is not a resize', async () => {
  const { DecimalNumber } = await import('../src/index.ts');
  const kinds = await run(async (s) => {
    const n = new DecimalNumber(10, { decimals: 1, anchor: 'start' }); await s.play(new FadeIn(n));
    await s.play(new Transform(n, n.copy().setValue(9)), { runTime: 0.3 });
  });
  assert.deepEqual(kinds, []);
});

test('two texts crossfading in one place are a ghost; out-then-in is not', async () => {
  const cross = await run(async (s) => {
    const a = new Text('now', { fontSize: 0.5 });
    const b = new Text('next', { fontSize: 0.5 });
    s.add(a);
    await s.play(new FadeOut(a), new FadeIn(b), { runTime: 0.4 });
  });
  assert.ok(cross.includes('ghost'), `crossfade should ghost, got ${cross}`);
  const sequenced = await run(async (s) => {
    const a = new Text('now', { fontSize: 0.5 });
    const b = new Text('next', { fontSize: 0.5 });
    s.add(a);
    await s.play(new FadeOut(a), { runTime: 0.3 });
    await s.play(new FadeIn(b), { runTime: 0.3 });
  });
  assert.deepEqual(sequenced, []);
});

test('a label that crosses its rectangle is overflow; a centered one is not', async () => {
  const high = await run(async (s) => {
    const label = new Text('HTTP 400', { fontSize: 0.4 });
    const rect = new Rectangle({ width: 3, height: 0.7 });
    const g = new Labeled(rect, label, { center: false });
    label.shift([0, 0.22]);
    s.add(g);
    await s.wait(0.2);
  });
  assert.ok(high.includes('overflow'), `expected overflow, got ${high}`);
  const fit = await run(async (s) => {
    const label = new Text('HTTP 400', { fontSize: 0.4 });
    const rect = new Rectangle({ width: label.width() + 0.8, height: label.height() + 0.4 });
    s.add(new Labeled(rect, label));
    await s.wait(0.2);
  });
  assert.deepEqual(fit, []);
});

test('every example scene is free of motion discontinuities', async () => {
  const { SCENES } = await import('../scenes/index.ts');
  for (const [name, { Scene }] of Object.entries(SCENES)) {
    const sink = new MotionSink();
    await new Scene(sink).run();
    const events = analyzeMotion(sink);
    assert.deepEqual(events.map((e) => `${e.t}s ${e.kind} [${e.step}] ${e.what}`), [], name);
  }
});
