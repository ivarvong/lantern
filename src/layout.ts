// Layout: a card sized to its rows, and a connector that reaches its target
// without entering anything else.
//
// The motion verifier (src/verify.ts) rejects a resting frame that breaks the
// same rules these helpers follow: a connector crossing a glyph run or a box
// edge, a box whose contents sit in one corner, two shapes occupying the same
// space, or two texts closer than the minimum gap. Routing and stacking go
// through here so a scene does not hand-place a line through a label.

import { Group } from './mobject.ts';
import type { Box, Mobject } from './mobject.ts';
import { Arc, Line, Rectangle } from './shapes.ts';
import type { Vec } from './vec.ts';
import { Text } from './text.ts';

/** Distances in scene units. The frame is 16 × 9. */
export const LAYOUT = {
  // Close enough to shave a glyph or a border. Diagrams already keep a smaller
  // gap than this between a node and the arrow that stops at its edge; the
  // end pad covers that attachment. A line through the middle is not an end.
  clearance: 0.05,
  endPad: 0.22,
  // Code blocks in the examples lead at about 0.036. Tighter than that is a crush.
  minGap: 0.03,
  fillSlack: 0.42,
} as const;

function expand(box: Box, m: number): Box {
  return [box[0] - m, box[1] - m, box[2] + m, box[3] + m];
}

/** Parameter interval of the segment inside the closed box, as fractions of its length. */
function segmentInterval(a: Vec, b: Vec, box: Box): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const d = [dx, dy];
  for (let axis = 0; axis < 2; axis++) {
    const min = box[axis]!, max = box[axis + 2]!;
    const p = a[axis]!, dp = d[axis]!;
    if (Math.abs(dp) < 1e-9) {
      if (p < min - 1e-9 || p > max + 1e-9) return null;
      continue;
    }
    let s0 = (min - p) / dp, s1 = (max - p) / dp;
    if (s0 > s1) { const t = s0; s0 = s1; s1 = t; }
    if (s0 > t0) t0 = s0;
    if (s1 < t1) t1 = s1;
    if (t0 > t1 + 1e-9) return null;
  }
  return [t0, t1];
}

/**
 * True when the segment comes within `clearance` of `box` somewhere that is
 * not an attachment at either end. A short segment whose middle lies inside
 * the box is still a crossing: the whole thing is not an attachment.
 */
/** The segment enters `box` itself, not merely its clearance margin, away from either end. */
export function segmentCrosses(a: Vec, b: Vec, box: Box, endPad: number = LAYOUT.endPad): boolean {
  return segmentBlocked(a, b, box, 0, endPad);
}

function onOrIn(p: Vec, box: Box): boolean {
  return p[0] >= box[0] - 1e-6 && p[0] <= box[2] + 1e-6 && p[1] >= box[1] - 1e-6 && p[1] <= box[3] + 1e-6;
}

export function segmentBlocked(
  a: Vec, b: Vec, box: Box,
  clearance: number = LAYOUT.clearance,
  endPad: number = LAYOUT.endPad,
  endPadEnd: number = endPad,
): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return false;
  // Both ends on or inside the box: the segment rides the border or lies in the
  // interior. An attachment has one end outside and only clips the near end.
  if (len > 0.03 && onOrIn(a, box) && onOrIn(b, box)) return true;
  const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const inside = mid[0] > box[0] && mid[0] < box[2] && mid[1] > box[1] && mid[1] < box[3];
  // Ends outside, middle inside: the segment cuts through, however short it is.
  if (inside) {
    const aIn = a[0] > box[0] && a[0] < box[2] && a[1] > box[1] && a[1] < box[3];
    const bIn = b[0] > box[0] && b[0] < box[2] && b[1] > box[1] && b[1] < box[3];
    if (!aIn && !bIn) return true;
  }
  const iv = segmentInterval(a, b, expand(box, clearance));
  if (!iv) return false;
  const near0 = endPad / len;
  const near1 = 1 - endPadEnd / len;
  // The excused zones belong to the connector's own ends. When they cover the
  // whole segment, this piece is an attachment, not a run along the box.
  if (near0 >= near1 - 1e-9) return false;
  return Math.min(iv[1], near1) - Math.max(iv[0], near0) > 1e-3;
}

/** An obstacle and how far a connector must stay from it. Endpoints use 0: the line may sit against the ink, and only entering it is a crossing. */
interface Zone { box: Box; clearance: number }

/** A hop that is not a connector end. Grid steps use this so a short piece cannot inherit the end pad. */
function hopBlocked(a: Vec, b: Vec, zones: readonly Zone[], pad0: number, pad1: number): boolean {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.015) return false;
  for (const z of zones) if (segmentBlocked(a, b, z.box, z.clearance, pad0, pad1)) return true;
  return false;
}

function pathClearZones(points: readonly Vec[], zones: readonly Zone[]): boolean {
  const last = points.length - 2;
  for (let i = 0; i <= last; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const pad0 = i === 0 ? LAYOUT.endPad : 0;
    const pad1 = i === last ? LAYOUT.endPad : 0;
    if (hopBlocked(a, b, zones, pad0, pad1)) return false;
  }
  return true;
}

export function pathClear(points: readonly Vec[], boxes: readonly Box[], clearance: number = LAYOUT.clearance): boolean {
  return pathClearZones(points, boxes.map((box) => ({ box, clearance })));
}

function facing(from: Vec, to: Vec): Vec {
  return Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1])
    ? [Math.sign(to[0] - from[0]) || 1, 0]
    : [0, Math.sign(to[1] - from[1]) || -1];
}

/** A point just outside `mob`, on the side toward `other`. Inside a rectangle, that point is on the rectangle's edge. */
export function anchorPoint(mob: Mobject, other: Mobject, rects: readonly Box[], dock: 'auto' | 'side' | 'facing' = 'auto'): Vec {
  const c = mob.center();
  const o = other.center();
  const host = rects
    .filter((b) => c[0] > b[0] + 0.02 && c[0] < b[2] - 0.02 && c[1] > b[1] + 0.02 && c[1] < b[3] - 0.02)
    .sort((a, b) => (a[2] - a[0]) * (a[3] - a[1]) - (b[2] - b[0]) * (b[3] - b[1]))[0];
  const dir = facing(c, o);
  if (host) {
    const tall = host[3] - host[1] > 1.15;
    const useSide = dock === 'side' || (dock === 'auto' && tall);
    if (useSide) {
      const left = Math.abs(o[0] - host[0]) <= Math.abs(o[0] - host[2]);
      const x = left ? host[0] : host[2];
      const y = Math.min(host[3] - 0.12, Math.max(host[1] + 0.12, c[1]));
      return [x, y];
    }
    if (dir[0] !== 0) {
      const x = dir[0] > 0 ? host[2] : host[0];
      const y = Math.min(host[3] - 0.1, Math.max(host[1] + 0.1, c[1]));
      return [x, y];
    }
    const y = dir[1] > 0 ? host[3] : host[1];
    const x = Math.min(host[2] - 0.1, Math.max(host[0] + 0.1, c[0]));
    return [x, y];
  }
  const b = mob.box();
  if (!b) return c;
  // Outside the glyph box, on the face toward the other point. A sideways exit
  // at mid-height lets the next bend run back through the glyphs.
  // Outside the checker's 0.05 glyph clearance, close enough that the line meets the word.
  const pad = 0.09;
  const dx = o[0] - c[0], dy = o[1] - c[1];
  const xOn = Math.min(b[2] - 0.04, Math.max(b[0] + 0.04, o[0]));
  const yOn = Math.min(b[3] - 0.04, Math.max(b[1] + 0.04, o[1]));
  if (Math.abs(dy) >= Math.abs(dx) * 0.65) return dy > 0 ? [xOn, b[3] + pad] : [xOn, b[1] - pad];
  return dx > 0 ? [b[2] + pad, yOn] : [b[0] - pad, yOn];
}

function dedupe(points: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 0.02) continue;
    out.push(p);
  }
  // Drop the middle of a straight run.
  const slim: Vec[] = [];
  for (const p of out) {
    const n = slim.length;
    if (n >= 2) {
      const a = slim[n - 2]!, b = slim[n - 1]!;
      const col = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 0.02;
      if (col) { slim[n - 1] = p; continue; }
    }
    slim.push(p);
  }
  return slim;
}

function pathLength(points: readonly Vec[]): number {
  let n = 0;
  for (let i = 0; i < points.length - 1; i++) n += Math.hypot(points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1]);
  return n;
}

/** Orthogonal routes around `boxes`. The first clear one wins; a grid search covers the rest. */
export function routePoints(start: Vec, end: Vec, boxes: readonly Box[], clearance: number = LAYOUT.clearance): Vec[] {
  return routeZones(start, end, boxes.map((box) => ({ box, clearance })));
}

function routeZones(start: Vec, end: Vec, zones: readonly Zone[]): Vec[] {
  const elbows: Vec[][] = [
    [start, end],
    [start, [end[0], start[1]], end],
    [start, [start[0], end[1]], end],
  ];
  for (const z of zones) {
    const pad = z.clearance + 0.06;
    const b = z.box;
    const L = b[0] - pad, R = b[2] + pad, T = b[3] + pad, B = b[1] - pad;
    elbows.push(
      [start, [L, start[1]], [L, end[1]], end],
      [start, [R, start[1]], [R, end[1]], end],
      [start, [start[0], T], [end[0], T], end],
      [start, [start[0], B], [end[0], B], end],
      [start, [start[0], end[1]], [end[0], end[1]], end],
    );
  }
  const clear = elbows.map(dedupe).filter((p) => p.length >= 2 && pathClearZones(p, zones));
  if (clear.length) return clear.sort((a, b) => pathLength(a) - pathLength(b))[0]!;
  const grid = gridRoute(start, end, zones);
  return grid ?? dedupe([start, end]);
}

function gridRoute(start: Vec, end: Vec, zones: readonly Zone[]): Vec[] | null {
  const step = 0.22;
  let minX = Math.min(start[0], end[0]) - 0.8, maxX = Math.max(start[0], end[0]) + 0.8;
  let minY = Math.min(start[1], end[1]) - 0.8, maxY = Math.max(start[1], end[1]) + 0.8;
  for (const z of zones) {
    const b = z.box;
    minX = Math.min(minX, b[0] - 0.8); maxX = Math.max(maxX, b[2] + 0.8);
    minY = Math.min(minY, b[1] - 0.8); maxY = Math.max(maxY, b[3] + 0.8);
  }
  minX = Math.max(minX, -8.2); maxX = Math.min(maxX, 8.2);
  minY = Math.max(minY, -4.6); maxY = Math.min(maxY, 4.6);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = minX; x <= maxX + 1e-6; x += step) xs.push(Math.round(x * 100) / 100);
  for (let y = minY; y <= maxY + 1e-6; y += step) ys.push(Math.round(y * 100) / 100);
  if (!xs.includes(start[0])) xs.push(start[0]);
  if (!xs.includes(end[0])) xs.push(end[0]);
  if (!ys.includes(start[1])) ys.push(start[1]);
  if (!ys.includes(end[1])) ys.push(end[1]);
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const nodes: Vec[] = [];
  const index = new Map<string, number>();
  const add = (p: Vec): number => {
    const k = `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    const have = index.get(k);
    if (have != null) return have;
    const i = nodes.length;
    nodes.push(p); index.set(k, i);
    return i;
  };
  // A grid point inside a clearance moat can never be a middle step, and it
  // splits the one hop that is allowed to arrive at the edge.
  const inZone = (p: Vec): boolean => zones.some((z) =>
    p[0] > z.box[0] - z.clearance && p[0] < z.box[2] + z.clearance &&
    p[1] > z.box[1] - z.clearance && p[1] < z.box[3] + z.clearance);
  const sId = add(start), eId = add(end);
  for (const x of xs) for (const y of ys) {
    const p: Vec = [x, y];
    if (inZone(p)) continue;
    add(p);
  }
  const neigh: number[][] = nodes.map(() => []);
  const link = (i: number, j: number): void => {
    if (i === j) return;
    // Only the connector's own ends are attachments. A middle hop of one grid
    // step used to inherit the end pad and could run the length of a word.
    const pad0 = i === sId ? LAYOUT.endPad : 0;
    const pad1 = j === eId ? LAYOUT.endPad : 0;
    if (hopBlocked(nodes[i]!, nodes[j]!, zones, pad0, pad1)) return;
    neigh[i]!.push(j);
  };
  // Orthogonal neighbors: same x or same y, adjacent in the sorted line.
  const byX = new Map<string, number[]>();
  const byY = new Map<string, number[]>();
  nodes.forEach((p, i) => {
    const kx = p[0].toFixed(2), ky = p[1].toFixed(2);
    const row = byY.get(ky) ?? []; row.push(i); byY.set(ky, row);
    const col = byX.get(kx) ?? []; col.push(i); byX.set(kx, col);
  });
  for (const ids of byY.values()) {
    ids.sort((a, b) => nodes[a]![0] - nodes[b]![0]);
    for (let i = 0; i < ids.length - 1; i++) { link(ids[i]!, ids[i + 1]!); link(ids[i + 1]!, ids[i]!); }
  }
  for (const ids of byX.values()) {
    ids.sort((a, b) => nodes[a]![1] - nodes[b]![1]);
    for (let i = 0; i < ids.length - 1; i++) { link(ids[i]!, ids[i + 1]!); link(ids[i + 1]!, ids[i]!); }
  }
  const prev = new Array<number>(nodes.length).fill(-1);
  const seen = new Array<boolean>(nodes.length).fill(false);
  const q = [sId];
  seen[sId] = true;
  for (let qi = 0; qi < q.length && !seen[eId]; qi++) {
    const i = q[qi]!;
    for (const j of neigh[i]!) if (!seen[j]) { seen[j] = true; prev[j] = i; q.push(j); }
  }
  if (!seen[eId]) return null;
  const path: Vec[] = [];
  for (let i = eId; i >= 0; i = prev[i]!) { path.push(nodes[i]!); if (i === sId) break; }
  path.reverse();
  const slim = dedupe(path);
  // Collapsing a stair into one segment can cut back across a border the steps avoided.
  if (pathClearZones(slim, zones)) return slim;
  return pathClearZones(path, zones) ? path : null;
}

export interface RouteOpts {
  stroke?: string;
  strokeWidth?: number;
  clearance?: number;
  /** 'side' meets a tall card at the row's height. 'facing' meets the near edge. */
  dock?: 'auto' | 'side' | 'facing';
}

/**
 * A polyline from `from` to `to` that stays `clearance` off every obstacle.
 * The ends attach to the nearest box edge, or to the token's own edge when
 * it is not inside a box. The result is a Group of Lines.
 */
export function route(from: Mobject, to: Mobject, avoid: readonly Mobject[], opts: RouteOpts = {}): Group {
  const clearance = opts.clearance ?? LAYOUT.clearance;
  const stroke = opts.stroke ?? '#ffffff';
  const strokeWidth = opts.strokeWidth ?? 0.04;
  const zones: Zone[] = [];
  const rects: Box[] = [];
  for (const m of avoid) {
    const b = m.box();
    if (!b || b[2] - b[0] < 0.02 || b[3] - b[1] < 0.02) continue;
    zones.push({ box: b, clearance });
    if (m instanceof Rectangle) rects.push(b);
  }
  const start = anchorPoint(from, to, rects, 'facing');
  const end = anchorPoint(to, from, rects, opts.dock ?? 'auto');
  // Endpoints are not given the obstacle clearance: the anchor sits against the
  // ink, and a line may leave along that face. Entering the ink is still blocked.
  for (const m of [from, to]) {
    if (avoid.includes(m)) continue;
    const b = m.box();
    if (!b || b[2] - b[0] < 0.02 || b[3] - b[1] < 0.02) continue;
    zones.push({ box: b, clearance: 0 });
  }
  const points = routeZones(start, end, zones);
  const lines: Line[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) continue;
    lines.push(new Line(a, b, { stroke, strokeWidth }));
  }
  if (!lines.length) lines.push(new Line(start, end, { stroke, strokeWidth }));
  return new Group(...lines);
}

export interface CardOpts {
  padding?: number;
  gap?: number;
  align?: 'start' | 'center';
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  fillOpacity?: number;
  cornerRadius?: number;
}

export interface CardPlan {
  width: number;
  height: number;
  frameCenter: Vec;
  /** Where each row's anchor goes: left-center for 'start', center for 'center'. */
  anchors: Vec[];
}

/**
 * A rectangle sized to a vertical stack of rows. Padding is even because the
 * frame is rebuilt from the rows; a row that leaves is taken out of the stack
 * and the frame shrinks, so contents cannot sink into a corner of a stale box.
 */
export class Card extends Group {
  padding: number;
  gap: number;
  align: 'start' | 'center';
  radius: number;
  stroke: string;
  strokeWidth: number;
  fill: string;
  fillOpacity: number;
  private laid = false;

  constructor({ padding = 0.28, gap = 0.16, align = 'start', stroke = '#ffffff', strokeWidth = 0.04, fill = '#ffffff', fillOpacity = 0.06, cornerRadius = 0.12 }: CardOpts = {}) {
    const frame = new Rectangle({ width: 1, height: 1, cornerRadius, stroke, strokeWidth, fill, fillOpacity });
    super(frame);
    this.padding = padding;
    this.gap = gap;
    this.align = align;
    this.radius = cornerRadius;
    this.stroke = stroke;
    this.strokeWidth = strokeWidth;
    this.fill = fill;
    this.fillOpacity = fillOpacity;
  }

  get frame(): Rectangle { return this.children[0] as Rectangle; }

  /** Rows currently stacked, in order. The frame is always child 0. */
  get rows(): Mobject[] { return this.children.slice(1); }

  private stack(rows: readonly Mobject[]): { w: number; h: number; local: Vec[] } {
    const pad = this.padding, gap = this.gap;
    const heights = rows.map((r) => Math.max(r.height(), 0.16));
    const widths = rows.map((r) => Math.max(r.width(), 0.16));
    const maxW = Math.max(0.4, ...widths);
    const stackH = heights.reduce((s, h) => s + h, 0) + gap * Math.max(0, rows.length - 1);
    const w = maxW + pad * 2;
    const h = Math.max(stackH + pad * 2, pad * 2 + 0.2);
    const top = h / 2;
    const left = -w / 2 + pad;
    let y = top - pad;
    const local: Vec[] = [];
    for (let i = 0; i < rows.length; i++) {
      const cy = y - heights[i]! / 2;
      local.push(this.align === 'center' ? [0, cy] : [left, cy]);
      y -= heights[i]! + gap;
    }
    return { w, h, local };
  }

  /**
   * World targets for `rows`, keeping the current top or center.
   * `moveTo(anchor, LEFT)` lands a start-aligned row; `moveTo(anchor)` lands a centered one.
   */
  plan(rows: readonly Mobject[], fixed: 'top' | 'center' = 'top'): CardPlan {
    const { w, h, local } = this.stack(rows);
    const pin = !this.laid ? [0, h / 2] as Vec : fixed === 'top' ? this.frame.top() : this.frame.center();
    const frameCenter: Vec = fixed === 'top' || !this.laid ? [pin[0], pin[1] - h / 2] : [pin[0], pin[1]];
    return {
      width: w, height: h, frameCenter,
      anchors: local.map((p) => [frameCenter[0] + p[0], frameCenter[1] + p[1]]),
    };
  }

  /** A frame of the planned size, for Transform. */
  frameTarget(plan: CardPlan): Rectangle {
    return new Rectangle({
      width: plan.width, height: plan.height, cornerRadius: this.radius,
      stroke: this.stroke, strokeWidth: this.strokeWidth, fill: this.fill, fillOpacity: this.fillOpacity,
    }).moveTo(plan.frameCenter);
  }

  /** Reparent `rows` and apply `plan` immediately. */
  layout(rows: readonly Mobject[], fixed: 'top' | 'center' = 'top'): this {
    const plan = this.plan(rows, fixed);
    for (const r of this.rows) if (!rows.includes(r)) this.remove(r);
    for (const r of rows) if (r.parent !== this) this.add(r);
    const target = this.frameTarget(plan);
    this.frame.subpaths = target.subpaths.map((a) => new Float32Array(a));
    this.frame.closed = target.closed.slice();
    this.frame.touchPoints();
    this.frame.invalidateBox();
    const edge = this.align === 'center' ? undefined : ([-1, 0] as Vec);
    rows.forEach((r, i) => { r.moveTo(plan.anchors[i]!, edge); });
    this.laid = true;
    return this;
  }
}

/** Texts and rectangles a connector must not enter. `except` and its descendants are the ends. */
export function obstacles(roots: readonly Mobject[], except: readonly Mobject[], shown: (m: Mobject) => number): Mobject[] {
  const skip = new Set<Mobject>();
  for (const m of except) for (const f of m.family()) skip.add(f);
  const out: Mobject[] = [];
  const walk = (m: Mobject): void => {
    if (skip.has(m)) return;
    // An open arc is a connector. Its box is the region the next line must go around.
    const arc = m instanceof Arc && !m.closed[0];
    if ((m instanceof Text || m instanceof Rectangle || arc) && shown(m) > 0.2) out.push(m);
    for (const c of m.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}
