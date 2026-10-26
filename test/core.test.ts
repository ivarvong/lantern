import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Rectangle, Circle, Line, Arrow, Text, Group, Labeled, Transform, FadeIn, Create,
  Scene, StringSink, toSvgString, RIGHT, UP,
  loadFonts,
} from '../src/index.ts';

// Text shapes on glyph outlines; scenes load fonts in run(), bare tests do it here
await loadFonts();

test('cubic subdivision preserves the curve', () => {
  const c = new Circle({ radius: 1 });
  const before = Array.from({ length: 20 }, (_, i) => c.pointFromProportion(i / 20));
  c.insertNCurves(0, 7); // 4 -> 11 curves
  assert.equal(c.numCurves(), 11);
  // Every original sample still lies on the unit circle
  for (let i = 0; i < 100; i++) {
    const p = c.pointFromProportion(i / 100);
    assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 1) < 2e-3, `radius drift at ${i}`);
  }
  // The start point is unchanged
  assert.deepEqual(c.pointFromProportion(0).map((x) => +x.toFixed(4)), before[0]!.map((x) => +x.toFixed(4)));
});

test('alignWith equalizes structure between a square and a circle', () => {
  const sq = new Rectangle({ width: 2, height: 2 });
  const ci = new Circle({ radius: 1 }).shift(RIGHT);
  const target = ci.copy();
  sq.alignWith(target);
  assert.equal(sq.subpaths.length, target.subpaths.length);
  assert.equal(sq.subpaths[0]!.length, target.subpaths[0]!.length);
  assert.equal(ci.numCurves(), 4, 'original target untouched');
});

test('alignWith pads families with null copies', () => {
  const g1 = new Group(new Rectangle(), new Rectangle());
  const g2 = new Group(new Circle());
  g1.alignWith(g2);
  assert.equal(g1.children.length, 2);
  assert.equal(g2.children.length, 2);
  assert.equal(g2.children[1]!.style.opacity, 0);
});

test('Transform ends exactly on the target', async () => {
  const sink = new StringSink();
  const scene = new Scene(sink, { fps: 10 });
  const sq = new Rectangle({ width: 2, height: 2, fill: '#ff0000' });
  const ci = new Circle({ radius: 1, fill: '#0000ff' }).shift([3, 0]);
  scene.add(sq);
  await scene.play(new Transform(sq, ci), { runTime: 0.5 });
  assert.equal(sink.frames.length, 5);
  const c = sq.center();
  assert.ok(Math.abs(c[0] - 3) < 1e-4 && Math.abs(c[1]) < 1e-4);
  assert.equal(sq.style.fill, '#0000ff');
});

test('animate builder + Arrow + Text serialize', async () => {
  const sink = new StringSink({ width: 320 });
  const scene = new Scene(sink, { fps: 10 });
  const box = new Rectangle({ width: 3, height: 1, cornerRadius: 0.2 });
  const label = new Text('handler', { fontSize: 0.4 }).moveTo(box);
  const arrow = new Arrow([-4, 0], [-1.5, 0]);
  scene.add(box, label, arrow);
  await scene.play(new FadeIn(box, { shift: UP }), new Create(arrow), { runTime: 0.3 });
  await scene.play(box.animate.shift(UP), { runTime: 0.2 });
  assert.ok(Math.abs(box.center()[1] - 1) < 1e-4, "UP is +y");
  const svg = toSvgString(scene, { width: 320 });
  assert.match(svg, /<svg[^>]*viewBox="-8000 -4500 16000 9000"/);
  assert.ok(!svg.includes('<text'), 'text is outlines, not <text>');
  // box + arrow line + tip + 7 glyphs
  assert.ok((svg.match(/<path/g) || []).length >= 3 + 'handler'.length);
});

test('a scene camera sets the svg viewBox', async () => {
  const scene = new Scene(new StringSink());
  scene.frame = { w: 9, h: 18 };
  scene.add(new Text('a'));
  const svg = toSvgString(scene, { width: 100 });
  assert.match(svg, /viewBox="-4500 -9000 9000 18000"/);
  assert.match(svg, /height="200"/);
});

test('text is centered on its advance box, and that box sits inside a label', () => {
  const t = new Text('Hg', { fontSize: 0.4 });
  const b = t.box()!;
  assert.ok(Math.abs((b[0] + b[2]) / 2) < 1e-3, `horizontal center ${(b[0] + b[2]) / 2}`);
  assert.ok(Math.abs((b[1] + b[3]) / 2) < 1e-3, `vertical center ${(b[1] + b[3]) / 2}`);
  const label = new Text('filter tree:0', { fontSize: 0.36, font: 'mono' });
  const rect = new Rectangle({ width: label.width() + 0.7, height: 0.9, strokeWidth: 0.05 });
  new Labeled(rect, label);
  const lb = label.box()!, rb = rect.box()!;
  assert.ok(lb[1] > rb[1] + 0.04 && lb[3] < rb[3] - 0.04, `label ${[...lb]} rect ${[...rb]}`);
  const svg = toSvgString(new Scene(new StringSink()).add(label) as unknown as Scene, { width: 320 });
  // Normal-weight glyphs must not carry a stroke width: WebKit paints it as a second edge.
  assert.match(svg, /stroke="none"/);
  assert.equal(svg.includes('stroke-width'), false);
});

test('y is up in the model and flipped once, in path data', () => {
  const r = new Rectangle({ width: 2, height: 2 }).shift(UP);
  assert.deepEqual(r.center(), [0, 1]);
  assert.ok(r.top()[1] > r.bottom()[1], 'top() is the larger y');
  const d = new Line([0, 0], [0, 1]).toPathD();
  assert.match(d, /^M0 0C0 -333 0 -667 0 -1000$/, 'y = 1 is written as SVG y = -1000 (above center)');
});

test('deterministic: same scene, same frames', async () => {
  const build = async () => {
    const sink = new StringSink();
    const scene = new Scene(sink, { fps: 12 });
    const r = new Rectangle();
    scene.add(r);
    await scene.play(r.animate.shift(RIGHT).setFill('#00ff00'));
    return sink.frames.join('|');
  };
  assert.equal(await build(), await build());
});

test('ArcBetweenPoints hits both endpoints and bulges to the signed side', async () => {
  const { ArcBetweenPoints } = await import('../src/index.ts');
  const a = new ArcBetweenPoints([0, 0], [2, 0], { angle: Math.PI / 2 });
  const end = a.pointFromProportion(1), mid = a.pointFromProportion(0.5);
  assert.ok(Math.hypot(end[0] - 2, end[1]) < 1e-5);
  assert.ok(Math.abs(mid[0] - 1) < 1e-5 && Math.abs(mid[1] + (Math.SQRT2 - 1)) < 1e-5);
  const b = new ArcBetweenPoints([0, 0], [2, 0], { angle: -Math.PI / 2 });
  assert.ok(b.pointFromProportion(0.5)[1] > 0, 'negative angle bulges the other way');
});

test('DecimalNumber blends its value through Transform', async () => {
  const { DecimalNumber } = await import('../src/index.ts');
  const seen: string[] = [];
  const n = new DecimalNumber(0, { decimals: 1, suffix: 's' });
  const scene = new Scene({ frame: async () => { seen.push(n.text); } }, { fps: 10 });
  scene.add(n);
  await scene.play(new Transform(n, n.copy().setValue(2.5)), { runTime: 0.5 });
  assert.equal(n.text, '2.5s');
  assert.ok(seen.some((t) => /^1\.\ds$/.test(t)), `an intermediate value was rendered: ${seen}`);
});

test('a captioned step holds until its caption can be read', async () => {
  const words = 'one two three four five six seven eight nine ten eleven twelve'; // 12 words
  class S extends Scene { override async construct() { await this.step('a', { caption: words }); await this.wait(0.1); await this.step('b'); } }
  const saved = Scene.captionWpm;
  try {
    Scene.captionWpm = 120; // 12 words at 120 wpm: 6 s
    const scene = await new S(new StringSink(), { fps: 10 }).run();
    assert.ok(Math.abs(scene.steps[0]!.t1! - 6) < 1e-6, `held ${scene.steps[0]!.t1}s`);
    Scene.captionWpm = Infinity;
    const fast = await new S(new StringSink(), { fps: 10 }).run();
    assert.ok(Math.abs(fast.steps[0]!.t1! - 0.1) < 1e-6);
  } finally { Scene.captionWpm = saved; }
});

test('a copied Arrow owns its line and tip (no reference back to the original)', () => {
  const a = new Arrow([0, 0], [1, 0]);
  const c = a.copy();
  assert.equal(c.line, c.children[0]);
  assert.notEqual(c.line, a.line);
  c.putStartAndEndOn([0, 0], [0, 5]);
  assert.deepEqual(a.line.end().map((v) => +v.toFixed(3)), [0.7, 0], 'the original did not move');
});
