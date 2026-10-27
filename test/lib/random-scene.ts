// Random scenes from a seed, for the property tests and for reproducing
// their failures (SEED=n). Everything here is deterministic in the seed.
import {
  Scene, Group, Rectangle, Circle, Square, Line, Polygon, Arc, Dot, Text, Labeled,
  Transform, FadeIn, FadeOut, Create, Write, Indicate, MoveAlongPath, LaggedStart, AnimationGroup,
  UP, DOWN, LEFT, RIGHT, linear, smooth, rushInto, thereAndBack,
} from '../../src/index.ts';
import type { Animation, AnimateBuilder, Mobject, Playable, SceneClass, Style, Vec } from '../../src/index.ts';

/** A seeded uniform draw in [lo, hi), with integer, pick and coin-flip helpers. */
export interface Rng {
  (lo?: number, hi?: number): number;
  int(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  bool(p?: number): boolean;
}

/** mulberry32: a small seeded PRNG so every failure is reproducible. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = (lo = 0, hi = 1): number => lo + next() * (hi - lo);
  r.int = (lo: number, hi: number): number => Math.floor(r(lo, hi + 1));
  // xs is never empty here, so the index is in range
  r.pick = <T>(xs: readonly T[]): T => xs[r.int(0, xs.length - 1)]!;
  r.bool = (p = 0.5): boolean => next() < p;
  return r;
}

// A trailing XML-illegal character rides on a real hex colour so style blending
// still parses, and the serializer has to drop it. Names that are also
// prototype keys show up as text.
const COLORS = ['#ffffff', '#58c4dd', '#5cd0b3', '#83c167', '#f0ac5f', '#fc6255', '#888888', '#ffff00', '#9a72ac', '#ffffff\u0000', '#58c4dd\u0001', '#000000\u0008', '#fc6255\u000b', '#ffff00\u001f'];
const WORDS = ['a', 'hello', 'Worker handler', 'x = 1', '→ 42', 'Ω', 'pyex #29', 'constructor', 'toString', '__proto__'];

function randomStyle(r: Rng): Style {
  return { fill: r.pick(COLORS), fillOpacity: r(0, 1), stroke: r.bool(0.8) ? r.pick(COLORS) : 'none', strokeWidth: r(0.01, 0.1), opacity: r.bool(0.9) ? 1 : r(0, 1) };
}

export function randomShape(r: Rng, depth = 0): Mobject {
  const s = randomStyle(r);
  switch (r.int(0, depth > 1 ? 7 : 9)) {
    case 0: return new Rectangle({ width: r(0.1, 4), height: r(0.1, 3), cornerRadius: r.bool() ? r(0, 0.5) : 0, ...s });
    case 1: return new Circle({ radius: r(0.05, 2), ...s });
    case 2: return new Square({ side: r(0.1, 2), ...s });
    case 3: return new Line([r(-6, 6), r(-3, 3)], [r(-6, 6), r(-3, 3)], s);
    case 4: return new Polygon(Array.from({ length: r.int(3, 7) }, (): Vec => [r(-2, 2), r(-2, 2)]), s);
    case 5: return new Arc({ radius: r(0.2, 2), startAngle: r(0, 6.3), angle: r(-6, 6), ...s });
    case 6: return new Dot({ radius: r(0.03, 0.3), color: r.pick(COLORS) });
    case 7: return new Text(r.pick(WORDS), { fontSize: r(0.1, 0.6), font: r.bool() ? 'sans' : 'mono', weight: r.bool(0.3) ? 'bold' : 'normal', anchor: r.pick(['start', 'middle', 'end'] as const) });
    case 8: return new Group(...Array.from({ length: r.int(1, 3) }, () => randomShape(r, depth + 1))).arrange(r.pick([RIGHT, DOWN]), r(0, 0.5));
    default: return new Labeled(randomShape(r, depth + 1), new Text(r.pick(WORDS), { fontSize: r(0.1, 0.4) }));
  }
}

export function place<M extends Mobject>(r: Rng, m: M): M {
  m.moveTo([r(-6, 6), r(-3, 3)]);
  if (r.bool(0.3)) m.scale(r(0.3, 2));
  if (r.bool(0.3)) m.rotate(r(-3, 3));
  return m;
}

function randomAnimation(r: Rng, _scene: Scene, pool: Mobject[]): Animation | AnimateBuilder<Mobject> {
  const m = r.pick(pool);
  switch (r.int(0, 8)) {
    case 0: return new FadeIn(m, { shift: r.bool() ? [r(-1, 1), r(-1, 1)] : null, scale: r(0.5, 1.5) });
    case 1: return new FadeOut(m, { shift: r.bool() ? [r(-1, 1), r(-1, 1)] : null });
    case 2: return new Create(m);
    case 3: return m instanceof Text ? new Write(m) : new Create(m);
    case 4: { const t = place(r, randomShape(r)); return new Transform(m, t, { replace: r.bool(0.3) }); }
    case 5: return m.animate.shift([r(-2, 2), r(-2, 2)]).setFill(r.pick(COLORS)).scale(r(0.5, 1.5));
    case 6: return new Indicate(m, { color: r.pick(COLORS), scaleFactor: r(1, 1.4) });
    case 7: return new MoveAlongPath(m, new Line([r(-5, 5), r(-3, 3)], [r(-5, 5), r(-3, 3)]), { fromCurrent: r.bool() });
    default: return new LaggedStart(pool.map((x) => new FadeIn(x)), { lagRatio: r(0, 1) });
  }
}

/** A scene from a seed. `log` collects things the invariants check after plays. */
export function makeScene(seed: number, log: Array<[Mobject, Mobject]> | null = null): SceneClass {
  return class extends Scene {
    override async construct(): Promise<void> {
      const r = rng(seed);
      const pool = Array.from({ length: r.int(1, 5) }, () => place(r, randomShape(r)));
      this.add(...pool);
      const state = (this.state = { seed, plays: 0 });
      const plays = r.int(2, 6);
      for (let i = 0; i < plays; i++) {
        if (r.bool(0.4)) await this.step(`s${i}`, { i });
        // One play drives each mobject at most once (Scene.play enforces it)
        const free = [...pool].sort(() => r() - 0.5);
        const anims: Playable[] = Array.from({ length: r.int(1, Math.min(3, free.length)) }, () => randomAnimation(r, this, [free.pop()!]));
        if (anims.some((a) => (a as Partial<AnimationGroup>).animations)) anims.splice(1); // a LaggedStart over the pool plays alone
        const rate = r.pick([linear, smooth, rushInto, thereAndBack]);
        await this.play(...anims, { runTime: r(0.05, 0.8), rateFunc: rate });
        state.plays = i + 1;
        for (const a of anims) if (a instanceof Transform && !(a.remover) && log) log.push([a.mobject, a.target]);
        if (r.bool(0.3)) await this.wait(r(0.03, 0.4));
      }
    }
  };
}

