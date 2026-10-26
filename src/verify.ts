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
//   pierce     a connector crosses a glyph run or a box edge away from its ends
//   fill       a box's contents sit in one corner of it (the box was not sized to them),
//              or a portrait camera's settled picture covers less than PHONE_CANVAS_FILL
//              of the frame area. Coverage is the union of text and rectangle boxes,
//              not the vertical distance between the top mark and the bottom one.
//   void       a portrait camera has an empty horizontal band taller than PHONE_BAND_GAP
//              (about 48px on a 390-wide phone). Connector strokes do not fill a band.
//   span       a portrait connector is longer than PHONE_CONNECTOR_MAX
//   overlap    two settled shapes occupy the same space, and neither declares it
//   margin     two settled texts are closer than the minimum gap
//   intrude    a moving text that belongs to no box crosses a label inside one
//              (a token flying through a card's rows, not into an empty slot)
//   clip       settled text runs past the camera (the viewport cuts a glyph)
//
// A cut-out and cut-in in the same frame with matching boxes is a seamless
// handoff and is not reported. Every event carries the step it happened in.

import { VMobject } from './vmobject.ts';
import type { Box, HasText, Mobject } from './mobject.ts';
import type { Scene, Sink } from './scene.ts';
import { Text } from './text.ts';
import { Arc, Labeled, Line, Rectangle } from './shapes.ts';
import { LAYOUT, segmentBlocked } from './layout.ts';

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

export type MotionKind = 'teleport' | 'resize' | 'pop' | 'cut-in' | 'cut-out' | 'flicker' | 'handoff' | 'ghost' | 'overflow' | 'pierce' | 'fill' | 'void' | 'span' | 'overlap' | 'margin' | 'intrude' | 'clip';

/**
 * A portrait camera's settled picture must cover this fraction of the frame
 * area. The measure is the union of text and rectangle boxes, so pinning one
 * mark at the top and another at the bottom does not count as coverage.
 */
export const PHONE_CANVAS_FILL = 0.5;

/**
 * Tallest empty horizontal band a portrait camera may hold, in scene units.
 * The phone frame is 16 units across 390px, so this is 48px.
 */
export const PHONE_BAND_GAP = 48 * (16 / 390);

/**
 * Longest connector on a portrait camera, in scene units. A short elbow between
 * adjacent bands fits; a diagonal across an empty band does not. 10 units is
 * about 244px at 390 wide.
 */
export const PHONE_CONNECTOR_MAX = 10;

/** A one-frame gap between animations is not a picture. A held sparse frame is. */
const CANVAS_FILL_HOLD = 0.18;

/** Ink may sit this close to the camera edge without counting as clipped. */
const CLIP_SLACK = 0.12;
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
  /** When the current portrait picture first settled below PHONE_CANVAS_FILL. */
  private canvasLowSince: number | null;
  /** When an empty band taller than PHONE_BAND_GAP first settled. */
  private voidSince: number | null;
  /** When a connector longer than PHONE_CONNECTOR_MAX first settled. */
  private spanSince: number | null;
  constructor() {
    this.frames = []; this.labels = new Map(); this.layoutEvents = []; this.layoutSeen = new Set();
    this.canvasLowSince = null; this.voidSince = null; this.spanSince = null;
  }
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
    this.sampleGeometry(scene, texts, shown);
  }

  /** True when this leaf's size changed over the last quarter-second: a pulse, not a layout. */
  private pulsing(id: number, w: number, h: number): boolean {
    const back = this.frames[Math.max(0, this.frames.length - 8)];
    const p = back?.leaves.get(id);
    if (!p) return false;
    return Math.abs(p.w - w) > 0.04 || Math.abs(p.h - h) > 0.04;
  }

  /** True when this leaf is holding still, so a layout error is the picture and not a midpoint of a move. */
  private resting(id: number, cx: number, cy: number, w: number, h: number): boolean {
    const prev = this.frames[this.frames.length - 2];
    if (!prev) return true;
    const p = prev.leaves.get(id);
    if (!p) return false;
    return Math.hypot(p.cx - cx, p.cy - cy) < 0.025 && Math.abs(p.w - w) < 0.03 && Math.abs(p.h - h) < 0.03;
  }

  /**
   * Geometric layout, on every frame whose picture is holding still.
   * A connector is a Line or an open Arc (arrow shafts and routed polylines).
   * It may meet a box edge or a token only at its own ends.
   */
  private sampleGeometry(scene: Scene, texts: Text[], shown: (m: Text) => number): void {
    const frame = this.frames.length - 1;
    const step = scene.currentStep?.path ?? null;
    const t = +scene.time.toFixed(3);
    const note = (kind: MotionKind, key: string, what: string, magnitude: number, detail: string): void => {
      if (this.layoutSeen.has(key)) return;
      this.layoutSeen.add(key);
      this.layoutEvents.push({ kind, frame, t, step, what, magnitude: +magnitude.toFixed(3), detail });
    };
    const leaf = (m: Mobject): LeafSample | undefined => this.frames[frame]!.leaves.get(m.id);
    const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const contains = (a: Box, b: Box, tol = 0.03) => a[0] <= b[0] + tol && a[1] <= b[1] + tol && a[2] >= b[2] - tol && a[3] >= b[3] - tol;
    const overlapBox = (a: Box, b: Box): number => {
      const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
      const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
      return ix * iy;
    };

    // One connector is one polyline. The end pad applies at its two ends only;
    // a stair of short hops is not a row of attachments.
    type RawSeg = { id: number; a: [number, number]; b: [number, number] };
    type ConnSeg = RawSeg & { pad0: number; pad1: number };
    const lineGroups = new Map<number, RawSeg[]>();
    const arcGroups = new Map<number, RawSeg[]>();
    const arcBoxes: Array<{ id: number; box: Box }> = [];
    const segs: ConnSeg[] = [];
    const rects: Array<{ m: Rectangle; box: Box }> = [];
    const liveRects: Array<{ m: Rectangle; box: Box }> = [];
    const near = (p: [number, number], q: [number, number]): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.04;
    const connLens: Array<{ id: number; len: number }> = [];
    const chain = (raw: RawSeg[]): ConnSeg[] => {
      const left = raw.map((s) => ({ ...s }));
      const chains: RawSeg[][] = [];
      while (left.length) {
        const path = [left.pop()!];
        let grew = true;
        while (grew) {
          grew = false;
          for (let i = 0; i < left.length; i++) {
            const s = left[i]!;
            const head = path[0]!, tail = path[path.length - 1]!;
            let next: RawSeg | null = null;
            let at: 'head' | 'tail' = 'tail';
            if (near(s.b, head.a)) { next = s; at = 'head'; }
            else if (near(s.a, head.a)) { next = { id: s.id, a: s.b, b: s.a }; at = 'head'; }
            else if (near(s.a, tail.b)) { next = s; at = 'tail'; }
            else if (near(s.b, tail.b)) { next = { id: s.id, a: s.b, b: s.a }; at = 'tail'; }
            if (!next) continue;
            if (at === 'head') path.unshift(next); else path.push(next);
            left.splice(i, 1);
            grew = true;
            break;
          }
        }
        chains.push(path);
      }
      const out: ConnSeg[] = [];
      for (const path of chains) {
        let len = 0;
        path.forEach((s, i) => {
          len += Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
          out.push({ ...s, pad0: i === 0 ? LAYOUT.endPad : 0, pad1: i === path.length - 1 ? LAYOUT.endPad : 0 });
        });
        const head = path[0];
        if (head) connLens.push({ id: head.id, len });
      }
      return out;
    };
    const walk = (m: Mobject): void => {
      const drawn = (m.style.drawFraction ?? 1) >= 0.98 && alphaOf(m) >= 0.5;
      if (drawn && m instanceof Line) {
        const s = leaf(m);
        if (s && this.resting(m.id, s.cx, s.cy, s.w, s.h)) {
          const key = m.parent?.id ?? -m.id;
          const list = lineGroups.get(key) ?? [];
          list.push({ id: m.id, a: m.start(), b: m.end() });
          lineGroups.set(key, list);
        }
      } else if (drawn && m instanceof Arc && !m.closed[0]) {
        const s = leaf(m);
        if (s && this.resting(m.id, s.cx, s.cy, s.w, s.h)) {
          const n = 8;
          let prev = m.pointFromProportion(0);
          const samples: RawSeg[] = [];
          for (let i = 1; i <= n; i++) {
            const p = m.pointFromProportion(i / n);
            samples.push({ id: m.id, a: prev, b: p });
            prev = p;
          }
          arcGroups.set(m.id, samples);
          const b = m.box();
          if (b) arcBoxes.push({ id: m.id, box: b });
        }
      }
      if (drawn && m instanceof Rectangle) {
        const b = m.box();
        const s = leaf(m);
        // A pulse (Indicate) changes size for a few frames. That is not the layout.
        if (b && s && !this.pulsing(m.id, s.w, s.h) && alphaOf(m) >= 0.85) {
          liveRects.push({ m, box: b });
          if (this.resting(m.id, s.cx, s.cy, s.w, s.h) && alphaOf(m) >= 0.9) rects.push({ m, box: b });
        }
      }
      for (const c of m.children) walk(c);
    };
    for (const top of scene.mobjects) walk(top);
    for (const raw of lineGroups.values()) segs.push(...chain(raw));
    for (const raw of arcGroups.values()) segs.push(...chain(raw));
    const lineIds = new Set<number>();
    for (const list of lineGroups.values()) for (const s of list) lineIds.add(s.id);

    const glyphRuns: Array<{ m: Text; box: Box }> = [];
    for (const m of texts) {
      if (shown(m) < 0.45) continue;
      const b = m.box();
      const s = leaf(m);
      if (!b || !s) continue;
      glyphRuns.push({ m, box: b });
    }

    // A token that travels through a card is not a connector, so pierce never
    // sees it. Text that already belongs to some box (a row, a chip, a node
    // label) may cross a larger box around that one, as a camera move does.
    const belongs = (text: Mobject, rect: Mobject): boolean => {
      const host = rect.parent;
      if (!host) return false;
      for (let p: Mobject | null = text; p; p = p.parent) if (p === host || p === rect) return true;
      return false;
    };
    const owned = new Set<Text>();
    for (const g of glyphRuns) for (const r of liveRects) if (belongs(g.m, r.m)) owned.add(g.m);
    for (const g of glyphRuns) {
      if (owned.has(g.m) || shown(g.m) < 0.9) continue;
      const s = leaf(g.m);
      if (!s || this.resting(g.m.id, s.cx, s.cy, s.w, s.h)) continue;
      const cx = (g.box[0] + g.box[2]) / 2, cy = (g.box[1] + g.box[3]) / 2;
      for (const r of liveRects) {
        if (r.m.allowOverlap || g.m.allowOverlap) continue;
        const inset = 0.08;
        if (cx <= r.box[0] + inset || cx >= r.box[2] - inset || cy <= r.box[1] + inset || cy >= r.box[3] - inset) continue;
        // Entering an empty slot is the slot's job. Crossing a label that
        // already lives in the box is a token cutting through the card.
        const hitsContent = glyphRuns.some((other) => {
          if (other.m === g.m || !owned.has(other.m) || shown(other.m) < 0.9) return false;
          const ocx = (other.box[0] + other.box[2]) / 2, ocy = (other.box[1] + other.box[3]) / 2;
          if (ocx <= r.box[0] || ocx >= r.box[2] || ocy <= r.box[1] || ocy >= r.box[3]) return false;
          return overlapBox(g.box, other.box) > 0.01;
        });
        if (!hitsContent) continue;
        note('intrude', `intrude:${g.m.id}:r${r.m.id}`, `"${g.m.text.slice(0, 28)}"`, 1, 'this text crosses a box it is not part of');
      }
    }

    for (const seg of segs) {
      for (const g of glyphRuns) {
        if (!segmentBlocked(seg.a, seg.b, g.box, LAYOUT.clearance, seg.pad0, seg.pad1)) continue;
        note('pierce', `pierce:${seg.id}:${g.m.id}`, `"${g.m.text.slice(0, 28)}"`, 1, `connector (${seg.a[0].toFixed(2)},${seg.a[1].toFixed(2)})→(${seg.b[0].toFixed(2)},${seg.b[1].toFixed(2)}) crosses this text`);
      }
      for (const r of rects) {
        if (r.m.allowOverlap) continue;
        if (!segmentBlocked(seg.a, seg.b, r.box, 0, seg.pad0, seg.pad1)) continue;
        note('pierce', `pierce:${seg.id}:r${r.m.id}`, `Rectangle#${r.m.id}`, 1, 'connector crosses this box');
      }
      // A line that enters another connector's arc is the same kind of crossing.
      if (!lineIds.has(seg.id)) continue;
      for (const arc of arcBoxes) {
        if (!segmentBlocked(seg.a, seg.b, arc.box, 0, seg.pad0, seg.pad1)) continue;
        note('pierce', `pierce:${seg.id}:a${arc.id}`, `Arc#${arc.id}`, 1, 'connector crosses this arc');
      }
    }

    for (const r of rects) {
      if (r.m.allowOverlap) continue;
      // A cluster or a shell holds other boxes. Its own label sits at the top;
      // the fill rule is for a box whose contents are the text, sized to that text.
      const holdsBox = rects.some((other) => {
        if (other.m === r.m || area(other.box) < 0.15) return false;
        const cx = (other.box[0] + other.box[2]) / 2, cy = (other.box[1] + other.box[3]) / 2;
        return cx > r.box[0] && cx < r.box[2] && cy > r.box[1] && cy < r.box[3];
      });
      if (holdsBox) continue;
      // A Labeled shape already placed its label (centered, or pinned as a title).
      // Fill is for a bare rectangle whose text was positioned by hand.
      if (r.m.parent instanceof Labeled && r.m.parent.shape === r.m) continue;
      const inside: Box[] = [];
      let pending = false;
      for (const g of glyphRuns) {
        const cx = (g.box[0] + g.box[2]) / 2, cy = (g.box[1] + g.box[3]) / 2;
        const cxIn = cx > r.box[0] && cx < r.box[2] && cy > r.box[1] && cy < r.box[3];
        if (!cxIn) continue;
        const a = shown(g.m);
        if (a > 0.05 && a < 0.995) pending = true;
      }
      if (pending) continue;
      for (const g of glyphRuns) {
        if (shown(g.m) < 0.995) continue;
        const s = leaf(g.m);
        if (!s || !this.resting(g.m.id, s.cx, s.cy, s.w, s.h)) continue;
        const cx = (g.box[0] + g.box[2]) / 2, cy = (g.box[1] + g.box[3]) / 2;
        const cxIn = cx > r.box[0] && cx < r.box[2] && cy > r.box[1] && cy < r.box[3];
        if (!cxIn) {
          const hit = overlapBox(g.box, r.box);
          if (hit > 0.012 && !g.m.allowOverlap) note('overlap', `overlap:t${g.m.id}:r${r.m.id}`, `"${g.m.text.slice(0, 24)}"`, hit, 'text sits across a box edge');
          continue;
        }
        inside.push(g.box);
      }
      if (!inside.length) continue;
      // A row leaving this box is still its child. The gap it opens is the
      // exit, and the frame closes in the same gesture.
      let leaving = false;
      for (const g of glyphRuns) {
        if (shown(g.m) < 0.5 || !belongs(g.m, r.m)) continue;
        const s = leaf(g.m);
        if (s && !this.resting(g.m.id, s.cx, s.cy, s.w, s.h)) { leaving = true; break; }
      }
      if (leaving) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const b of inside) {
        minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]);
        maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]);
      }
      const gapTop = r.box[3] - maxY, gapBot = minY - r.box[1];
      const h = r.box[3] - r.box[1];
      const slack = Math.abs(gapTop - gapBot);
      const sunk = Math.max(gapTop, gapBot);
      // A short chip or bar is centered. A tall card is sized to its rows, so the
      // empty margin is the padding on both sides, not a corner the rows fell into.
      const bad = h >= 1.15 ? sunk > LAYOUT.fillSlack && slack > LAYOUT.fillSlack : slack > 0.24 && sunk > 0.3;
      if (bad) {
        const names = glyphRuns.filter((g) => {
          const cx = (g.box[0] + g.box[2]) / 2, cy = (g.box[1] + g.box[3]) / 2;
          return cx > r.box[0] && cx < r.box[2] && cy > r.box[1] && cy < r.box[3];
        }).map((g) => g.m.text.slice(0, 20)).join(' | ');
        note('fill', `fill:${r.m.id}`, `Rectangle#${r.m.id}`, slack, `content margin top ${gapTop.toFixed(2)} bottom ${gapBot.toFixed(2)} [${names}] h=${h.toFixed(2)}`);
      }
    }

    const settledText: Array<{ m: Text; box: Box }> = [];
    for (const g of glyphRuns) {
      if (shown(g.m) < 0.995) continue;
      const s = leaf(g.m);
      if (!s || !this.resting(g.m.id, s.cx, s.cy, s.w, s.h)) continue;
      settledText.push(g);
    }
    for (let i = 0; i < settledText.length; i++) {
      for (let j = i + 1; j < settledText.length; j++) {
        const A = settledText[i]!, B = settledText[j]!;
        if (A.m.allowOverlap || B.m.allowOverlap) continue;
        const inter = overlapBox(A.box, B.box);
        const minA = Math.min(area(A.box), area(B.box));
        if (inter > 0.012 && inter > 0.2 * minA && !contains(A.box, B.box) && !contains(B.box, A.box)) {
          note('overlap', `overlap:${Math.min(A.m.id, B.m.id)}:${Math.max(A.m.id, B.m.id)}`, `"${A.m.text.slice(0, 18)}" × "${B.m.text.slice(0, 18)}"`, inter, 'two texts occupy the same space');
          continue;
        }
        if (inter > 0.004) continue;
        const xOverlap = Math.min(A.box[2], B.box[2]) - Math.max(A.box[0], B.box[0]);
        const yOverlap = Math.min(A.box[3], B.box[3]) - Math.max(A.box[1], B.box[1]);
        const vGap = yOverlap < 0 ? -yOverlap : 0;
        const hGap = xOverlap < 0 ? -xOverlap : 0;
        const sameLine = Math.abs((A.box[1] + A.box[3]) / 2 - (B.box[1] + B.box[3]) / 2) < 0.06;
        if (sameLine && hGap >= 0 && hGap < 0.08) continue;
        const stacked = xOverlap > 0.15 * Math.min(A.box[2] - A.box[0], B.box[2] - B.box[0]);
        if (stacked && vGap > 0.001 && vGap < LAYOUT.minGap) {
          note('margin', `margin:${Math.min(A.m.id, B.m.id)}:${Math.max(A.m.id, B.m.id)}`, `"${A.m.text.slice(0, 18)}" × "${B.m.text.slice(0, 18)}"`, vGap, `vertical gap ${vGap.toFixed(3)}`);
        }
      }
    }

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const A = rects[i]!, B = rects[j]!;
        if (A.m.allowOverlap || B.m.allowOverlap) continue;
        if (contains(A.box, B.box) || contains(B.box, A.box)) continue;
        const inter = overlapBox(A.box, B.box);
        if (inter <= 0.02) continue;
        note('overlap', `overlap:r${Math.min(A.m.id, B.m.id)}:r${Math.max(A.m.id, B.m.id)}`, `Rectangle#${A.m.id} × Rectangle#${B.m.id}`, inter, 'two boxes occupy the same space');
      }
    }

    const cam = scene.frame;
    const hx = cam.w / 2, hy = cam.h / 2;
    for (const g of glyphRuns) {
      if (shown(g.m) < 0.9) continue;
      const s = leaf(g.m);
      if (!s || !this.resting(g.m.id, s.cx, s.cy, s.w, s.h)) continue;
      const past = Math.max(-hx - g.box[0], -hy - g.box[1], g.box[2] - hx, g.box[3] - hy, 0);
      if (past <= CLIP_SLACK) continue;
      // Off-camera text (a column the camera has panned away from) is not a cut.
      // A cut is a glyph the viewer can still read, with the rest past the edge.
      const visW = Math.min(g.box[2], hx) - Math.max(g.box[0], -hx);
      const visH = Math.min(g.box[3], hy) - Math.max(g.box[1], -hy);
      if (visW < 0.2 || visH < 0.08) continue;
      note('clip', `clip:${g.m.id}`, `"${g.m.text.slice(0, 28)}"`, past, `text runs ${past.toFixed(2)} past the frame`);
    }

    // Portrait only. A 16:9 scene is a different camera; this is the phone canvas.
    if (!(cam.h > cam.w)) { this.canvasLowSince = null; this.voidSince = null; this.spanSince = null; return; }
    // Opacity, not fillOpacity: a card filled at a few percent is fully on screen.
    // A fade that has not landed — even a first frame at nearly zero — is the
    // picture still arriving, so a settled code line is not the whole frame.
    const revealOf = (m: Mobject): number => (m.style.opacity ?? 1) * (m.style.drawFraction ?? 1);
    let flux = false;
    const watch = (m: Mobject): void => {
      if (flux) return;
      const unit = m.mergeLeaves && m.children.length > 0;
      const drawn = unit || (m instanceof VMobject && m.hasPoints());
      if (drawn) {
        const rev = unit ? Math.max(...m.children.map(revealOf)) : revealOf(m);
        if (rev > 0 && rev < 0.98) flux = true;
        else if (rev >= 0.98) {
          const s = leaf(m);
          if (s && !this.resting(m.id, s.cx, s.cy, s.w, s.h)) flux = true;
        }
      }
      if (!unit && !flux) for (const c of m.children) watch(c);
    };
    for (const top of scene.mobjects) watch(top);
    if (flux) { this.canvasLowSince = null; this.voidSince = null; this.spanSince = null; return; }
    // Connector strokes are not content: a diagonal across a hole must not hide it,
    // and its bounding box must not count as coverage.
    const boxes: Box[] = [];
    const clipToFrame = (b: Box): Box | null => {
      const x0 = Math.max(b[0], -hx), y0 = Math.max(b[1], -hy);
      const x1 = Math.min(b[2], hx), y1 = Math.min(b[3], hy);
      if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return null;
      return [x0, y0, x1, y1];
    };
    let nText = 0;
    for (const g of glyphRuns) {
      if (shown(g.m) < 0.85) continue;
      const c = clipToFrame(g.box);
      if (c) { boxes.push(c); nText++; }
    }
    for (const r of rects) {
      if (area(r.box) < 0.08) continue;
      const c = clipToFrame(r.box);
      if (c) boxes.push(c);
    }
    if (nText < 1) { this.canvasLowSince = null; this.voidSince = null; this.spanSince = null; return; }
    const covered = unionArea(boxes);
    const frameArea = cam.w * cam.h;
    const need = PHONE_CANVAS_FILL * frameArea;
    if (covered + 1e-3 >= need) this.canvasLowSince = null;
    else if (this.canvasLowSince == null) this.canvasLowSince = t;
    else if (t - this.canvasLowSince >= CANVAS_FILL_HOLD) {
      const ratio = covered / frameArea;
      note('fill', 'fill:canvas', 'canvas', +(need - covered).toFixed(3), `canvas fill ${ratio.toFixed(2)} < ${PHONE_CANVAS_FILL} (content covers ${covered.toFixed(1)} of ${frameArea.toFixed(1)})`);
    }
    const gaps = emptyBands(boxes, -hy, hy);
    let worst: [number, number] | null = null;
    for (const g of gaps) if (!worst || g[1] - g[0] > worst[1] - worst[0]) worst = g;
    const gapH = worst ? worst[1] - worst[0] : 0;
    if (gapH <= PHONE_BAND_GAP + 1e-3) this.voidSince = null;
    else if (this.voidSince == null) this.voidSince = t;
    else if (t - this.voidSince >= CANVAS_FILL_HOLD && worst) {
      note('void', 'void:canvas', 'canvas', +gapH.toFixed(3), `empty band ${gapH.toFixed(2)} > ${PHONE_BAND_GAP.toFixed(2)} from y ${worst[0].toFixed(2)} to ${worst[1].toFixed(2)}`);
    }
    let long: { id: number; len: number } | null = null;
    for (const c of connLens) if (c.len > PHONE_CONNECTOR_MAX && (!long || c.len > long.len)) long = c;
    if (!long) this.spanSince = null;
    else if (this.spanSince == null) this.spanSince = t;
    else if (t - this.spanSince >= CANVAS_FILL_HOLD) {
      note('span', `span:${long.id}`, 'connector', +long.len.toFixed(3), `connector length ${long.len.toFixed(2)} > ${PHONE_CONNECTOR_MAX}`);
    }
  }
}

/** Area of the union of axis-aligned boxes. */
function unionArea(boxes: readonly Box[]): number {
  const ys = new Set<number>();
  for (const b of boxes) { ys.add(b[1]); ys.add(b[3]); }
  const y = [...ys].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const y0 = y[i]!, y1 = y[i + 1]!;
    const dy = y1 - y0;
    if (dy < 1e-9) continue;
    const mid = (y0 + y1) / 2;
    const xs: Array<[number, number]> = [];
    for (const b of boxes) if (b[1] <= mid && b[3] >= mid && b[2] > b[0]) xs.push([b[0], b[2]]);
    xs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let w = 0, curL = 0, curR = 0, open = false;
    for (const [l, r] of xs) {
      if (!open || l > curR) {
        if (open) w += curR - curL;
        curL = l; curR = r; open = true;
      } else curR = Math.max(curR, r);
    }
    if (open) w += curR - curL;
    total += w * dy;
  }
  return total;
}

/** Uncovered y-intervals of [y0, y1], from boxes that occupy a horizontal band. */
function emptyBands(boxes: readonly Box[], y0: number, y1: number): Array<[number, number]> {
  const iv = boxes
    .map((b) => [Math.max(y0, b[1]), Math.min(y1, b[3])] as [number, number])
    .filter((b) => b[1] - b[0] > 1e-4)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const seg of iv) {
    const last = merged[merged.length - 1];
    if (!last || seg[0] > last[1] + 1e-4) merged.push([seg[0], seg[1]]);
    else last[1] = Math.max(last[1], seg[1]);
  }
  const gaps: Array<[number, number]> = [];
  let cursor = y0;
  for (const seg of merged) {
    if (seg[0] - cursor > 1e-3) gaps.push([cursor, seg[0]]);
    cursor = Math.max(cursor, seg[1]);
  }
  if (y1 - cursor > 1e-3) gaps.push([cursor, y1]);
  return gaps;
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
