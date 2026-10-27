// Property tests: random scenes, built from a seed, must satisfy the engine's
// invariants. The hand-written scenes exercise the paths their authors
// thought of; these exercise the rest. A failure prints its seed; rerun one
// with SEED=<n>. Fast mode runs 40 seeds, FULL=1 runs 400.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, StringSink, SnapshotSink, Text, Transform, renderAt, traceScene, indexScene, renderText, loadFonts, VMobject } from '../src/index.ts';
import type { Box, Mobject, Sink, StyleRecord } from '../src/index.ts';
import { rng, makeScene, place, randomShape } from './lib/random-scene.ts';
import { assertSvgs } from './lib/svg-oracle.ts';

await loadFonts();
const SEEDS = process.env.SEED ? [Number(process.env.SEED)] : Array.from({ length: process.env.FULL ? 400 : 40 }, (_, i) => i + 1);

const bruteBox = (m: Mobject): Box | null => {
  let b: Box | null = null;
  for (const f of m.family()) for (const a of f.pointArrays()) for (let i = 0; i < a.length; i += 2) {
    const x = a[i]!, y = a[i + 1]!;
    if (!b) b = [x, y, x, y];
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
};

test('random scenes: deterministic, finite, cache-exact, box-exact, seek-exact', async () => {
  for (const seed of SEEDS) {
    const ctx = `seed ${seed}`;
    VMobject.validateCaches = true;
    try {
      const S = makeScene(seed);
      const a = new StringSink(), b = new StringSink();
      const sa = new Scene(a, { fps: 20 }); Object.setPrototypeOf(sa, S.prototype);
      // box(): the cache must agree with a fresh computation at every frame
      const boxSink: Sink = { async frame(scene) {
        await a.frame(scene);
        for (const top of scene.mobjects) for (const m of top.family()) {
          const cached = m.box(), fresh = bruteBox(m);
          assert.deepEqual(cached, fresh, `${ctx}: stale box on ${m.constructor.name}#${m.id} at t=${scene.time}`);
        }
      } };
      await new S(boxSink, { fps: 20 }).run();
      await new S(b, { fps: 20 }).run();
      assert.ok(a.frames.length > 1, ctx);
      assert.deepEqual(a.frames, b.frames, `${ctx}: not deterministic`);
      for (const f of a.frames) assert.ok(!/NaN|Infinity|undefined/.test(f), `${ctx}: non-finite output`);
      // Strict XML parse, tag and attribute allowlist, background and width round-trip
      assertSvgs(a.frames, { width: 1280, background: '#1a1a1a' });
      // seeking to 3 times lands on the exact frame
      const ix = await indexScene(S, { fps: 20 });
      const r = rng(seed * 7919);
      for (let k = 0; k < 3; k++) {
        const t = r(0, ix.duration);
        const snap = new SnapshotSink();
        const scene = await renderAt(S, t, snap, { fps: 20 });
        const i = Math.round(scene.time * 20);
        assert.equal(snap.svg, a.frames[i], `${ctx}: seek to ${t.toFixed(3)} (frame ${i}) differs from the full run`);
        renderText(scene); // must not throw
      }
      await traceScene(S); // must not throw
    } finally { VMobject.validateCaches = false; }
  }
});

test('Transform lands exactly on its target: same path data and style, leaf by leaf', async () => {
  for (const seed of SEEDS) {
    const S = makeScene(seed);
    const checks: number[] = [];
    const scene = new S({ async frame() {} }, { fps: 20 });
    const origPlay = scene.play.bind(scene);
    // Check right after each play, before the next one moves things again
    scene.play = async (...args) => {
      const r = await origPlay(...args);
      for (const an of args) if (an instanceof Transform && an.constructor === Transform && !an.replace && !an.remover && Math.abs(an.rateFunc(1) - 1) < 1e-9) {
        const got = an.mobject.family(), want = an.targetCopy.family();
        assert.equal(got.length, want.length, `seed ${seed}: family sizes differ after Transform`);
        got.forEach((g, i) => {
          const w = want[i]!; // same length, asserted above
          if (g instanceof VMobject && w instanceof VMobject) assert.equal(g.toPathD(), w.toPathD(), `seed ${seed}: ${g.constructor.name}#${g.id} ended off its target`);
          else if (g instanceof VMobject) {
            // A path morphing into something with no path of its own collapses to its center
            const c = w.center();
            for (const arr of g.pointArrays()) for (let j = 0; j < arr.length; j += 2) assert.ok(Math.hypot(arr[j]! - c[0], arr[j + 1]! - c[1]) < 1e-4, `seed ${seed}: ${g.constructor.name}#${g.id} should have collapsed to its target's center`);
          }
          for (const k of Object.keys(w.style) as Array<keyof StyleRecord>) if (k !== 'drawFraction') assert.equal(g.style[k], w.style[k], `seed ${seed}: style ${k} ended as ${g.style[k]}, target ${w.style[k]}`);
        });
        checks.push(1);
      }
      return r;
    };
    await scene.run();
  }
});

test('subdividing any cubic path preserves its geometry (random paths, random n)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    const n = r.int(1, 6), p = new VMobject();
    p.startNewPath([r(-2, 2), r(-2, 2)]);
    for (let i = 0; i < n; i++) p.addCubic([r(-2, 2), r(-2, 2)], [r(-2, 2), r(-2, 2)], [r(-2, 2), r(-2, 2)]);
    // Every point of the subdivided path must lie on the original. The reference is
    // the original sampled 4000 times per curve (about 2e-3 apart on the longest
    // paths here), so 3e-3 is the resolution of the check, not slack in the code.
    const ref: Array<[number, number]> = [];
    for (let c = 0; c < n; c++) for (let i = 0; i <= 4000; i++) ref.push(p.pointOnCurve(0, c, i / 4000));
    const start = p.pointFromProportion(0), end = p.pointFromProportion(1);
    p.insertNCurves(0, r.int(1, 12));
    assert.deepEqual(p.pointFromProportion(0), start); assert.deepEqual(p.pointFromProportion(1), end);
    for (let c = 0; c < p.numCurves(); c++) for (const t of [0, 0.25, 0.5, 0.75]) {
      const q = p.pointOnCurve(0, c, t);
      let d = Infinity;
      for (const a of ref) { const e = Math.hypot(a[0] - q[0], a[1] - q[1]); if (e < d) d = e; }
      assert.ok(d < 3e-3, `seed ${seed}: curve ${c} t=${t} is ${d.toFixed(4)} off the original path`);
    }
  }
});

test('copy() is deep: mutating a copy never touches the original', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const r = rng(seed);
    const m = place(r, randomShape(r));
    const before = JSON.stringify(m.family().map((f) => [f.style, f.pointArrays().map((a) => Array.from(a))]));
    const c = m.copy();
    c.shift([1, 1]).scale(2).setFill('#000000');
    for (const f of c.family()) for (const a of f.pointArrays()) if (a.length) a[0]! += 1;
    assert.equal(JSON.stringify(m.family().map((f) => [f.style, f.pointArrays().map((a) => Array.from(a))])), before, `seed ${seed}`);
    assert.ok(c.family().every((f) => !m.family().includes(f)), 'copy shares no mobjects with the original');
  }
});
