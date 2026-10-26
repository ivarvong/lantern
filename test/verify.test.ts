import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group, Rectangle, Circle, Text, Labeled, FadeIn, FadeOut, Transform, Create, MoveAlongPath, Line, Card, route, MotionSink, analyzeMotion, linear, RIGHT, LEFT, DOWN, PHONE_TYPE_CODE, PHONE_TYPE_LABEL, PHONE_TYPE_MAX, PHONE_PAD, PHONE_BAND_GAP, PHONE_CONNECTOR_MAX, PHONE_ANCHOR } from '../src/index.ts';
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
    await s.play(new Create(new Line([-3, 3], [3, 3])));
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

test('the old strip frame fails pierce and fill', async () => {
  // The held frame: a tall card, accept and git-protocol sunk at its bottom,
  // user-agent outside, and a straight line from the code through both.
  const kinds = await run(async (s) => {
    const accept = new Text('accept', { font: 'mono', fontSize: 0.46 }).moveTo([-1.2, -0.62], LEFT);
    const proto = new Text('git-protocol', { font: 'mono', fontSize: 0.46 }).moveTo([-1.2, -1.2], LEFT);
    const card = new Rectangle({
      width: 5.4, height: 3.83, cornerRadius: 0.12,
      stroke: '#ff9f1a', strokeWidth: 0.04, fill: '#ff9f1a', fillOpacity: 0.05,
    });
    card.moveTo([1.1, 0.25]);
    const ua = new Text('user-agent  ply-viewer/0.1.0', { font: 'mono', fontSize: 0.44 });
    ua.moveTo([0.4, -2.15]);
    const token = new Text('VIEWER_UA', { font: 'mono', fontSize: 0.5 }).moveTo([1.5, 3.2]);
    const line = new Line(token.bottom(), ua.center(), { stroke: '#ffffff', strokeWidth: 0.04 });
    s.add(card, accept, proto, ua, token, line);
    await s.wait(0.2);
  });
  assert.ok(kinds.includes('pierce'), `expected pierce, got ${kinds}`);
  assert.ok(kinds.includes('fill'), `expected fill, got ${kinds}`);
});

test('short hops along a glyph are one connector and a pierce', async () => {
  // A stair of grid steps used to inherit the end pad on every piece, so a line
  // could run the length of a word and the check called each step an attachment.
  const kinds = await run(async (s) => {
    const t = new Text('github.com', { font: 'mono', fontSize: 0.5 }).moveTo([0, 1.5]);
    const b = t.box()!;
    const y = b[1] - 0.03;
    const g = new Group();
    for (let x = b[0] + 0.05; x < b[2] - 0.3; x += 0.22) {
      g.add(new Line([x, y], [x + 0.22, y], { stroke: '#ffffff', strokeWidth: 0.04 }));
    }
    s.add(t, g);
    await s.wait(0.2);
  });
  assert.ok(kinds.includes('pierce'), `expected pierce, got ${kinds}`);
});

test('a token that flies through a foreign box is intrude; a row of that box is not', async () => {
  const through = await run(async (s) => {
    const card = new Card({ padding: 0.28, gap: 0.16, align: 'start' });
    const row = new Text('accept  */*', { font: 'mono', fontSize: 0.42 });
    card.layout([row]);
    const token = new Text('VIEWER_UA', { font: 'mono', fontSize: 0.5 }).moveTo([0, card.frame.top()[1] + 1.1]);
    s.add(card, token);
    await s.play(new Transform(token, token.copy().moveTo(row)), { runTime: 0.6 });
    await s.wait(0.1);
  });
  assert.ok(through.includes('intrude'), `expected intrude, got ${through}`);
  const row = await run(async (s) => {
    const card = new Card({ padding: 0.28, gap: 0.16, align: 'start' });
    card.layout([new Text('user-agent  ply-viewer/0.1.0', { font: 'mono', fontSize: 0.42 })]);
    s.add(card);
    await s.wait(0.2);
  });
  assert.deepEqual(row, []);
});

test('a card sized to its rows and a routed connector are clean', async () => {
  const kinds = await run(async (s) => {
    const card = new Card({ padding: 0.28, gap: 0.16, align: 'start', stroke: '#ff9f1a', fill: '#ff9f1a', fillOpacity: 0.06 });
    const rows = ['accept  */*', 'git-protocol  version=2', 'user-agent  ply-viewer/0.1.0'].map((t) => new Text(t, { font: 'mono', fontSize: 0.42 }));
    card.layout(rows);
    card.shift([0, 1.4 - card.frame.top()[1]]);
    const token = new Text('VIEWER_UA', { font: 'mono', fontSize: 0.5 }).moveTo([0, 3.3]);
    s.add(card, token);
    // Endpoints are not obstacles. The other rows and the frame are.
    s.add(route(token, rows[2]!, [card.frame, rows[0]!, rows[1]!], { stroke: '#ffffff', strokeWidth: 0.045, clearance: 0.14, dock: 'side' }));
    await s.wait(0.2);
  });
  assert.deepEqual(kinds, []);
});

test('overlapping settled texts are overlap; allowOverlap opts out', async () => {
  const piled = await run(async (s) => {
    const a = new Text('alpha', { fontSize: 0.6 });
    const b = new Text('beta', { fontSize: 0.6 }).shift([0.4, 0.08]);
    s.add(a, b);
    await s.wait(0.2);
  });
  assert.ok(piled.includes('overlap'), `expected overlap, got ${piled}`);
  const declared = await run(async (s) => {
    const a = new Text('one', { fontSize: 0.5 });
    const b = new Text('two', { fontSize: 0.5 });
    b.allowOverlap = true;
    s.add(a, b);
    await s.wait(0.2);
  });
  assert.deepEqual(declared, []);
});

test('stacked texts closer than the minimum gap are a margin error', async () => {
  const tight = await run(async (s) => {
    const a = new Text('alpha', { fontSize: 0.5 });
    const b = new Text('beta', { fontSize: 0.5 });
    b.moveTo([0, -(a.height() + 0.015)]);
    s.add(a, b);
    await s.wait(0.2);
  });
  assert.ok(tight.includes('margin'), `expected margin, got ${tight}`);
  const led = await run(async (s) => {
    const a = new Text('alpha', { fontSize: 0.5 });
    const b = new Text('beta', { fontSize: 0.5 });
    b.moveTo([0, -(a.height() + 0.04)]);
    s.add(a, b);
    await s.wait(0.2);
  });
  assert.deepEqual(led, []);
});

test('portrait type scale, padding, band gap and connector length are named', () => {
  assert.equal(PHONE_TYPE_CODE, 14 * (16 / 390));
  assert.equal(PHONE_TYPE_LABEL, 16 * (16 / 390));
  assert.equal(PHONE_TYPE_MAX, 24 * (16 / 390));
  assert.equal(PHONE_PAD, 8 * (16 / 390));
  assert.equal(PHONE_BAND_GAP, 48 * (16 / 390));
  assert.equal(PHONE_CONNECTOR_MAX, 24);
  assert.equal(PHONE_ANCHOR, 12 * (16 / 390));
});

test('portrait scale fails on type past the max and on a stretched box', async () => {
  const phone = { w: 16, h: 16 * (844 / 390) };
  const huge = await run(async (s) => {
    s.frame = phone;
    const t = new Text('No', { fontSize: PHONE_TYPE_MAX + 0.15 });
    s.add(t);
    await s.play(new FadeIn(t), { runTime: 0.2 });
    await s.wait(0.45);
  });
  assert.ok(huge.includes('scale'), `type above 24px should fail, got ${huge}`);
  const slab = await run(async (s) => {
    s.frame = phone;
    const label = new Text('host', { font: 'mono', fontSize: PHONE_TYPE_LABEL });
    const box = new Rectangle({ width: 14, height: 3.2, fill: '#5cd0b3', stroke: '#5cd0b3' });
    label.moveTo(box);
    s.add(box, label);
    await s.play(new FadeIn(box), new FadeIn(label), { runTime: 0.2 });
    await s.wait(0.45);
  });
  assert.ok(slab.includes('scale'), `a full-width slab should fail, got ${slab}`);
  const fitted = await run(async (s) => {
    s.frame = phone;
    const label = new Text('github.com', { font: 'mono', fontSize: PHONE_TYPE_LABEL });
    const box = new Rectangle({
      width: label.advance() + 2 * PHONE_PAD,
      height: label.height() + 2 * PHONE_PAD,
      fill: '#5cd0b3', stroke: '#5cd0b3',
    });
    label.moveTo(box);
    const emphasis = new Text('400', { font: 'mono', fontSize: PHONE_TYPE_MAX }).moveTo([0, -2]);
    s.add(box, label, emphasis);
    await s.play(new FadeIn(box), new FadeIn(label), new FadeIn(emphasis), { runTime: 0.2 });
    await s.wait(0.45);
  });
  assert.ok(!fitted.includes('scale'), `content plus padding, and 24px emphasis, should pass, got ${fitted}`);
  const wide = await run(async (s) => {
    const t = new Text('No', { fontSize: PHONE_TYPE_MAX + 0.4 });
    s.add(t);
    await s.play(new FadeIn(t), { runTime: 0.2 });
    await s.wait(0.45);
  });
  assert.ok(!wide.includes('scale'), `16:9 camera is not the phone canvas, got ${wide}`);
});

test('a connector that starts in the gap fails anchor; one that leaves the token does not', async () => {
  const detached = await run(async (s) => {
    const token = new Text('github.com', { font: 'mono', fontSize: 0.5 }).moveTo([0, 3]);
    const chip = new Rectangle({ width: 3, height: 1, fill: '#5cd0b3', stroke: '#5cd0b3' }).moveTo([0, -1]);
    const wire = new Line([0, 0.4], [0, -0.5], { stroke: '#ffffff', strokeWidth: 0.04 });
    const g = new Group(wire);
    g.anchorFrom = token;
    g.anchorTo = chip;
    s.add(token, chip, g);
    await s.play(new FadeIn(token), new FadeIn(chip), new Create(wire), { runTime: 0.25 });
    await s.wait(0.4);
  });
  assert.ok(detached.includes('anchor'), `a line that begins in empty space should fail, got ${detached}`);
  const attached = await run(async (s) => {
    const token = new Text('github.com', { font: 'mono', fontSize: 0.5 }).moveTo([0, 3]);
    const chip = new Rectangle({ width: 3, height: 1, fill: '#5cd0b3', stroke: '#5cd0b3' }).moveTo([0, -1]);
    const tb = token.box()!;
    const cb = chip.box()!;
    const wire = new Line([(tb[0] + tb[2]) / 2, tb[1]], [(cb[0] + cb[2]) / 2, cb[3]], { stroke: '#ffffff', strokeWidth: 0.04 });
    const g = new Group(wire);
    g.anchorFrom = token;
    g.anchorTo = chip;
    s.add(token, chip, g);
    await s.play(new FadeIn(token), new FadeIn(chip), new Create(wire), { runTime: 0.25 });
    await s.wait(0.4);
  });
  assert.ok(!attached.includes('anchor'), `a line from the token to the chip should pass, got ${attached}`);
});

test('a measures bar may be wide; void is only inside a group; a long connector is span', async () => {
  const phone = { w: 16, h: 16 * (844 / 390) };
  const bar = await run(async (s) => {
    s.frame = phone;
    const g = new Group();
    g.layoutGroup = 'trace';
    const rect = new Rectangle({ width: 12, height: 0.7, fill: '#5cd0b3', stroke: 'none' });
    rect.measures = true;
    const cap = new Text('ls-refs · 438 ms', { font: 'mono', fontSize: PHONE_TYPE_LABEL });
    cap.nextTo(rect, DOWN, 0.12, LEFT);
    g.add(rect, cap);
    s.add(g);
    await s.play(new FadeIn(rect), new FadeIn(cap), { runTime: 0.2 });
    await s.wait(0.45);
  });
  assert.ok(!bar.includes('scale') && !bar.includes('void'), `a duration bar should pass, got ${bar}`);
  const hole = await run(async (s) => {
    s.frame = phone;
    const g = new Group();
    g.layoutGroup = 'picture';
    const a = new Text('alpha', { font: 'mono', fontSize: PHONE_TYPE_LABEL }).moveTo([0, 6]);
    const b = new Text('beta', { font: 'mono', fontSize: PHONE_TYPE_LABEL }).moveTo([0, 0]);
    g.add(a, b);
    s.add(g);
    await s.play(new FadeIn(a), new FadeIn(b), { runTime: 0.2 });
    await s.wait(0.45);
  });
  assert.ok(hole.includes('void'), `a gap inside one group should fail, got ${hole}`);
  const bands = await run(async (s) => {
    s.frame = phone;
    const code = new Group();
    code.layoutGroup = 'code';
    code.add(new Text('code', { font: 'mono', fontSize: PHONE_TYPE_CODE }).moveTo([0, phone.h / 2 - 1.4]));
    const picture = new Group();
    picture.layoutGroup = 'picture';
    picture.add(new Text('github.com', { font: 'mono', fontSize: PHONE_TYPE_LABEL }));
    s.add(code, picture);
    await s.play(new FadeIn(code), new FadeIn(picture), { runTime: 0.2 });
    await s.wait(0.45);
  });
  assert.ok(!bands.includes('void'), `the margin between groups is not a void, got ${bands}`);
  const spanned = await run(async (s) => {
    s.frame = phone;
    const label = new Text('pkt', { font: 'mono', fontSize: PHONE_TYPE_LABEL });
    const chip = new Rectangle({
      width: label.advance() + 2 * PHONE_PAD,
      height: label.height() + 2 * PHONE_PAD,
      fill: '#5cd0b3', stroke: '#5cd0b3',
    });
    label.moveTo(chip);
    const wire = new Line([0, phone.h / 2 - 1], [0, -phone.h / 2 + 1], { stroke: '#ffffff', strokeWidth: 0.04 });
    s.add(chip, label, wire);
    await s.play(new FadeIn(label), new FadeIn(chip), new Create(wire), { runTime: 0.25 });
    await s.wait(0.45);
  });
  assert.ok(spanned.includes('span'), `a full-height connector should fail, got ${spanned}`);
  const local = await run(async (s) => {
    s.frame = phone;
    const label = new Text('pkt', { font: 'mono', fontSize: PHONE_TYPE_LABEL });
    const chip = new Rectangle({
      width: label.advance() + 2 * PHONE_PAD,
      height: label.height() + 2 * PHONE_PAD,
      fill: '#5cd0b3', stroke: '#5cd0b3',
    });
    label.moveTo(chip);
    const wire = new Line([-0.4, 1.2], [0.8, 1.2], { stroke: '#ffffff', strokeWidth: 0.04 });
    s.add(chip, label, wire);
    await s.play(new FadeIn(label), new FadeIn(chip), new Create(wire), { runTime: 0.25 });
    await s.wait(0.45);
  });
  assert.ok(!local.includes('span'), `a short connector should pass, got ${local}`);
});

test('settled text past the camera is clip', async () => {
  const kinds = await run(async (s) => {
    const t = new Text('clipped-token', { font: 'mono', fontSize: 0.6 }).moveTo([7.6, 0]);
    s.add(t);
    await s.play(new FadeIn(t), { runTime: 0.2 });
    await s.wait(0.3);
  });
  assert.ok(kinds.includes('clip'), `expected clip, got ${kinds}`);
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
