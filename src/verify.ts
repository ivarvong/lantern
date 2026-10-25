// Motion verifier: finds visual discontinuities ("jumps") between consecutive
// frames, from the scene itself rather than from pixels.
//
// MotionSink samples every drawn leaf each frame: box center, size, and
// effective alpha. analyzeMotion() then looks for events a viewer perceives as
// a jump rather than motion:
//
//   teleport   position changes far more in one frame than in the frames on
//              either side (a spike, not a fast smooth move)
//   resize     same, for size
//   pop        alpha changes by >= 0.5 in a single frame
//   cut-in     a leaf appears already mostly opaque (no fade, no draw-in)
//   cut-out    a leaf vanishes while mostly opaque
//   flicker    a leaf vanishes and comes back within a few frames
//   handoff    one leaf is replaced by another in the same frame (a
//              ReplacementTransform) but the replacement is somewhere else
//   ghost      two texts overlap while both are only partly opaque (a crossfade)
//   overflow   a label whose center sits in its shape sticks out of that shape
//
// A cut-out and cut-in in the same frame with matching boxes is a seamless
// handoff and is not reported. Every event carries the step it happened in.

import { VMobject } from './vmobject.ts';
import type { Box, HasText, Mobject } from './mobject.ts';
import type { Scene, Sink } from './scene.ts';
import { Text } from './text.ts';
import { Labeled } from './shapes.ts';

/** Thresholds for analyzeMotion(); see DEFAULTS. */
export interface MotionOptions {
  minJump?: number;
  spikeRatio?: number;
  minResize?: number;
  popAlpha?: number;
  cutAlpha?: number;
  flickerFrames?: number;
  handoffIoU?: number;
}

/** One drawn leaf in one frame: box center, size and effective alpha. */
export interface LeafSample { cx: number; cy: number; w: number; h: number; a: number; box: Box }
export interface MotionFrame { t: number; step: string | null; leaves: Map<number, LeafSample> }

export type MotionKind = 'teleport' | 'resize' | 'pop' | 'cut-in' | 'cut-out' | 'flicker' | 'handoff' | 'ghost' | 'overflow';
export interface MotionEvent { kind: MotionKind; frame: number; t: number; step: string | null; what: string; magnitude: number; detail: string }
export interface MotionSummary { kind: MotionKind; step: string | null; frame: number; t: number; count: number; max: number; examples: string[] }

const DEFAULTS: Required<MotionOptions> = {
  minJump: 0.2,      // scene units (frame is 16 wide, so ~1.25% of width, ~16px at 1280)
  spikeRatio: 3,     // displacement must exceed this multiple of both neighbors' displacement
  minResize: 0.25,   // relative size change in one frame
  popAlpha: 0.5,     // alpha change in one frame
  cutAlpha: 0.5,     // appearing/vanishing above this alpha is a cut
  flickerFrames: 3,
  handoffIoU: 0.6,
};

function alphaOf(m: Mobject): number {
  const s = m.style;
  const f = s.fill !== 'none' ? s.fillOpacity : 0;
  const k = s.stroke !== 'none' ? s.strokeOpacity : 0;
  // A path being drawn in is a reveal, not a pop
  return (s.opacity ?? 1) * Math.max(f, k) * (s.drawFraction ?? 1);
}

// Text-like mobjects carry their string as `text`; read it structurally
const textOf = (m: Mobject): string | undefined => (m as HasText).text;

function describeLeaf(m: Mobject): string {
  let p = m;
  while (p && textOf(p) == null && p.parent) { p = p.parent; }
  const text = textOf(p);
  const label = text != null ? `"${text.length > 28 ? text.slice(0, 27) + '…' : text}"` : '';
  return `${m.constructor.name}#${m.id}${label ? ' in ' + (p.constructor.name) + ' ' + label : ''}`;
}

export class MotionSink implements Sink {
  frames: MotionFrame[];
  labels: Map<number, string>;
  /** Text-layout failures sampled while the scene runs. One per offending mobject. */
  layoutEvents: MotionEvent[];
  private layoutSeen: Set<string>;
  constructor() { this.frames = []; this.labels = new Map(); this.layoutEvents = []; this.layoutSeen = new Set(); }
  async frame(scene: Scene): Promise<void> {
    const f = new Map<number, LeafSample>();
    const walk = (m: Mobject): void => {
      // A merged run (Text) is one visual thing whose glyphs are rebuilt when
      // its string changes, so it is tracked as a unit, not per glyph.
      const unit = m.mergeLeaves && m.children.length > 0;
      const drawn = unit || (m instanceof VMobject && m.hasPoints());
      if (drawn) {
        const a = unit ? Math.max(...m.children.map(alphaOf)) : alphaOf(m);
        if (a > 0.02) {
          const b = m.box();
          if (b) {
            f.set(m.id, { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[3] - b[1], a, box: b });
            if (!this.labels.has(m.id)) this.labels.set(m.id, describeLeaf(m));
          }
        }
      }
      if (!unit) for (const c of m.children) walk(c);
    };
    for (const top of scene.mobjects) walk(top);
    this.frames.push({ t: scene.time, step: scene.currentStep?.path ?? null, leaves: f });
    this.sampleLayout(scene);
  }

  /**
   * Two checks that a screenshot of a phone makes obvious and a motion spike does not:
   * a centered label must sit inside its shape, and two texts must not occupy the
   * same box while both are only partly opaque (a crossfade reads as smeared type).
   */
  private sampleLayout(scene: Scene): void {
    const frame = this.frames.length - 1;
    const step = scene.currentStep?.path ?? null;
    const t = +scene.time.toFixed(3);
    const texts: Text[] = [];
    const seenText = new Set<Text>();
    const walkText = (m: Mobject): void => {
      if (m instanceof Text) {
        if (!seenText.has(m)) { seenText.add(m); texts.push(m); }
        return;
      }
      for (const c of m.children) walkText(c);
    };
    for (const top of scene.mobjects) walkText(top);

    const shown = (m: Text): number => {
      if (!m.children.length) return m.style.opacity ?? 1;
      let max = 0;
      for (const c of m.children) max = Math.max(max, alphaOf(c));
      return max;
    };
    const partial: Array<{ m: Text; a: number; box: Box }> = [];
    for (const m of texts) {
      const a = shown(m);
      const b = m.box();
      if (b && a > 0.12 && a < 0.88) partial.push({ m, a, box: b });
    }
    for (let i = 0; i < partial.length; i++) {
      for (let j = i + 1; j < partial.length; j++) {
        const A = partial[i]!, B = partial[j]!;
        const ix = Math.max(0, Math.min(A.box[2], B.box[2]) - Math.max(A.box[0], B.box[0]));
        const iy = Math.max(0, Math.min(A.box[3], B.box[3]) - Math.max(A.box[1], B.box[1]));
        const inter = ix * iy;
        const area = (r: Box) => Math.max(1e-9, (r[2] - r[0]) * (r[3] - r[1]));
        if (inter <= 0.2 * Math.min(area(A.box), area(B.box))) continue;
        const key = `ghost:${Math.min(A.m.id, B.m.id)}:${Math.max(A.m.id, B.m.id)}`;
        if (this.layoutSeen.has(key)) continue;
        this.layoutSeen.add(key);
        const what = `"${A.m.text.slice(0, 24)}" × "${B.m.text.slice(0, 24)}"`;
        this.layoutEvents.push({ kind: 'ghost', frame, t, step, what, magnitude: +Math.min(A.a, B.a).toFixed(3), detail: `both at partial opacity (${A.a.toFixed(2)}, ${B.a.toFixed(2)})` });
      }
    }

    // A label whose center lies in its shape is supposed to be inside it.
    // Labels placed beside a shape (nextTo) have their center outside and are skipped.
    const tol = 0.04;
    const walkLabeled = (m: Mobject): void => {
      if (m instanceof Labeled && m.label && m.shape !== m.label) {
        const shapeBox = m.shape.box();
        const labels = m.label instanceof Text ? [m.label] : [];
        if (!(m.label instanceof Text)) {
          const inner: Text[] = [];
          const w = (n: Mobject): void => { if (n instanceof Text) inner.push(n); else for (const c of n.children) w(c); };
          w(m.label);
          labels.push(...inner);
        }
        if (shapeBox) for (const label of labels) {
          // Only a settled label. A fade's first frames are still near opacity 1
          // while the text has begun to move, and that is not a layout error.
          if (shown(label) < 0.995) continue;
          const lb = label.box();
          if (!lb) continue;
          const cx = (lb[0] + lb[2]) / 2, cy = (lb[1] + lb[3]) / 2;
          const inside = cx > shapeBox[0] && cx < shapeBox[2] && cy > shapeBox[1] && cy < shapeBox[3];
          if (!inside) continue;
          const overflow = Math.max(shapeBox[0] - lb[0], shapeBox[1] - lb[1], lb[2] - shapeBox[2], lb[3] - shapeBox[3]);
          if (overflow <= tol) continue;
          const key = `overflow:${label.id}`;
          if (this.layoutSeen.has(key)) continue;
          this.layoutSeen.add(key);
          this.layoutEvents.push({ kind: 'overflow', frame, t, step, what: `"${label.text.slice(0, 32)}"`, magnitude: +overflow.toFixed(3), detail: `sticks out of its box by ${overflow.toFixed(3)}` });
        }
      }
      for (const c of m.children) walkLabeled(c);
    };
    for (const top of scene.mobjects) walkLabeled(top);
  }
}

// Boxes are padded so thin shapes (a horizontal line has zero height) still overlap
const PAD = 0.05;
const iou = (a0: Box, b0: Box): number => {
  const a: Box = [a0[0] - PAD, a0[1] - PAD, a0[2] + PAD, a0[3] + PAD], b: Box = [b0[0] - PAD, b0[1] - PAD, b0[2] + PAD, b0[3] + PAD];
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy, area = (r: Box) => Math.max(1e-9, (r[2] - r[0]) * (r[3] - r[1]));
  return inter / (area(a) + area(b) - inter);
};

export function analyzeMotion(sink: MotionSink, opts: MotionOptions = {}): MotionEvent[] {
  const o = { ...DEFAULTS, ...opts };
  const F = sink.frames;
  const events: MotionEvent[] = [...sink.layoutEvents];
  const ev = (kind: MotionKind, f: number, id: number, magnitude: number, detail = '') =>
    events.push({ kind, frame: f, t: +F[f]!.t.toFixed(3), step: F[f]!.step, what: sink.labels.get(id) ?? `#${id}`, magnitude: +magnitude.toFixed(3), detail });

  const disp = (f: number, id: number): number => {
    const a = F[f - 1]?.leaves.get(id), b = F[f]?.leaves.get(id);
    return a && b ? Math.hypot(b.cx - a.cx, b.cy - a.cy) : 0;
  };
  const dsize = (f: number, id: number): number => {
    const a = F[f - 1]?.leaves.get(id), b = F[f]?.leaves.get(id);
    if (!a || !b) return 0;
    const rel = (x: number, y: number) => (Math.max(x, y) < 0.05 ? 0 : Math.abs(y - x) / Math.max(x, y));
    return Math.max(rel(a.w, b.w), rel(a.h, b.h));
  };
  const dalpha = (f: number, id: number): number => {
    const a = F[f - 1]?.leaves.get(id), b = F[f]?.leaves.get(id);
    return a && b ? Math.abs(b.a - a.a) : 0;
  };

  for (let f = 1; f < F.length; f++) {
    const prev = F[f - 1]!.leaves, cur = F[f]!.leaves;
    const cutIns: Array<[number, LeafSample]> = [], cutOuts: Array<[number, LeafSample]> = [];
    for (const [id, s] of cur) {
      const p = prev.get(id);
      if (!p) {
        if (s.a >= o.cutAlpha) cutIns.push([id, s]);
        continue;
      }
      const d = disp(f, id);
      if (d > o.minJump && d > o.spikeRatio * Math.max(disp(f - 1, id), disp(f + 1, id))) ev('teleport', f, id, d, `moved ${d.toFixed(2)} in one frame`);
      const z = dsize(f, id);
      if (z > o.minResize && z > o.spikeRatio * Math.max(dsize(f - 1, id), dsize(f + 1, id))) ev('resize', f, id, z, `size changed ${(100 * z).toFixed(0)}% in one frame`);
      const da = dalpha(f, id);
      if (da >= o.popAlpha) ev('pop', f, id, da, `alpha ${p.a.toFixed(2)} → ${s.a.toFixed(2)}`);
    }
    for (const [id, p] of prev) if (!cur.has(id) && p.a >= o.cutAlpha) cutOuts.push([id, p]);

    // Pair same-frame replacements: a matching box is a seamless handoff
    const usedIn = new Set<number>();
    for (const [oid, op] of cutOuts) {
      let best: [number, LeafSample] | null = null, bestScore = 0;
      for (const [iid, ip] of cutIns) {
        if (usedIn.has(iid)) continue;
        const score = iou(op.box, ip.box);
        if (score > bestScore) { best = [iid, ip]; bestScore = score; }
      }
      if (best && bestScore >= o.handoffIoU) { usedIn.add(best[0]); continue; }
      if (best && bestScore > 0) {
        usedIn.add(best[0]);
        const d = Math.hypot(best[1].cx - op.cx, best[1].cy - op.cy);
        ev('handoff', f, best[0], d, `replaced ${sink.labels.get(oid)} with box overlap ${(100 * bestScore).toFixed(0)}%`);
        continue;
      }
      // Gone: flicker if it comes back soon, else a hard cut
      let back = 0;
      for (let k = f + 1; k < Math.min(F.length, f + 1 + o.flickerFrames); k++) if (F[k]!.leaves.has(oid)) { back = k; break; }
      if (back) ev('flicker', f, oid, back - f, `hidden for ${back - f} frame(s)`);
      else ev('cut-out', f, oid, op.a, `vanished at alpha ${op.a.toFixed(2)}`);
    }
    for (const [iid, ip] of cutIns) if (!usedIn.has(iid)) {
      // A leaf already present in the first rendered frames of the scene is just the opening state
      if (f > 1) ev('cut-in', f, iid, ip.a, `appeared at alpha ${ip.a.toFixed(2)}`);
    }
  }
  return events;
}

/** Group events into one line per (kind, step, frame) burst, for reading. */
export function summarizeMotion(events: readonly MotionEvent[]): MotionSummary[] {
  const groups = new Map<string, MotionSummary>();
  for (const e of events) {
    const k = `${e.kind}|${e.step}|${e.frame}`;
    const g = groups.get(k) ?? { kind: e.kind, step: e.step, frame: e.frame, t: e.t, count: 0, max: 0, examples: [] };
    g.count++; g.max = Math.max(g.max, e.magnitude);
    if (g.examples.length < 2) g.examples.push(`${e.what}: ${e.detail}`);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => a.frame - b.frame);
}
