// Mobject: a tree of typed point buffers plus a style record.
//
// Points are canonical world coordinates (manim's model): every geometric
// operation maps a function over the point arrays of the whole family. The
// style record is blended field by field during animations.

import * as V from './vec.ts';
import type { Vec } from './vec.ts';
import { lerpColor } from './color.ts';
import { perf } from './perf.ts';
import type { MergedCache } from './svg.ts';

let nextId = 1;

const COLOR_KEYS = new Set(['fill', 'stroke']);

/** Paint. Scene units: the frame is 16 × 9, origin at the center, y up. */
export interface Style {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  opacity?: number;
  /** 0..1 of the path drawn (Create, Write). */
  drawFraction?: number;
}

/** A mobject's resolved style: every field set except the transient drawFraction. */
export type StyleRecord = Required<Omit<Style, 'drawFraction'>> & Pick<Style, 'drawFraction'>;

export const DEFAULT_STYLE: StyleRecord = {
  fill: 'none',
  fillOpacity: 1,
  stroke: '#ffffff',
  strokeWidth: 0.04,
  strokeOpacity: 1,
  opacity: 1,
};

/** [minX, minY, maxX, maxY] in scene units. */
export type Box = [minX: number, minY: number, maxX: number, maxY: number];

/** Called every frame with the mobject it was added to and the frame's dt. */
export type Updater<M extends Mobject = Mobject> = (m: M, dt: number) => void;

/** A function of points about a center: applyPointsFunction's argument. */
export type PointsFunction = (p: Vec) => Vec;
/** Per-point path for Transform: where a point is at alpha between its two ends. */
export type PathFunc = (start: Vec, end: Vec, alpha: number) => Vec;

export interface AboutOpts {
  aboutPoint?: Vec | null;
  aboutEdge?: Vec;
}

/** The part of an `.animate` builder that play() reads. */
export interface AnimateBuilderBase<M extends Mobject = Mobject> {
  readonly _isAnimateBuilder: true;
  readonly mobject: M;
  buildTarget(): M;
}

/** The methods of M that return the mobject itself: the ones `.animate` can chain. */
export type ChainableKeys<M> = { [K in Exclude<keyof M, 'animate'>]: M[K] extends (...args: never[]) => M ? K : never }[Exclude<keyof M, 'animate'>];

/**
 * `mob.animate`: the mobject's chainable methods, recorded instead of run, each
 * returning the builder so calls chain.
 */
export type AnimateBuilder<M extends Mobject> = AnimateBuilderBase<M> & {
  [K in ChainableKeys<M>]: M[K] extends (...args: infer A) => unknown ? (...args: A) => AnimateBuilder<M> : never;
};

/** Text-like mobjects carry their string; the verifier and the text renderer read it structurally. */
export interface HasText { text?: string }

export class Mobject {
  id: number;
  /** A name for lookup (doc node ids); `id` stays the unique number. */
  key: string | undefined;
  children: Mobject[];
  parent: Mobject | null;
  style: StyleRecord;
  updaters: Updater[];
  _bbox: Box | null;
  // Assigned lazily (first touchPoints, first merged render, Text): `declare` keeps
  // them off instances until then, exactly as the untyped code did.
  /** Points version: bumped by touchPoints(), keyed on by render caches. */
  declare _pv?: number;
  /** Merged-record cache for mergeLeaves groups, owned by svg.ts. */
  declare _mrec?: MergedCache;
  /** Render a group of same-styled leaves as one element (Text sets this). */
  declare mergeLeaves?: boolean;
  /**
   * This mobject is allowed to share space with another (a gauge fill inside
   * its shell, a highlight behind a line). Overlap is a layout error unless
   * one of the two declares it.
   */
  allowOverlap = false;
  /**
   * Portrait layout group. The void check measures empty bands inside one
   * group (code, picture, trace), not the margin between groups.
   */
  layoutGroup: string | null = null;
  /**
   * This rectangle's width encodes a quantity (bytes, time). The scale check
   * does not treat it as a label that must hug its text.
   */
  measures = false;
  /**
   * The token this connector leaves, and the datum it arrives at. The anchor
   * check requires the polyline's ends to sit on those two boxes.
   */
  anchorFrom: Mobject | null = null;
  anchorTo: Mobject | null = null;

  constructor(style: Style = {}) {
    this.id = nextId++;
    this.key = undefined;
    this.children = [];
    this.parent = null;
    this.style = { ...DEFAULT_STYLE, ...style };
    this.updaters = [];
    this._bbox = null;
  }

  // ---- data --------------------------------------------------------------

  /** The Float32Arrays (stride 2) a transform maps over. Subclasses override. */
  pointArrays(): Float32Array[] { return []; }

  hasPoints(): boolean { return this.pointArrays().some((a) => a.length > 0); }

  /** This mobject and every descendant, depth first. Pass `out` to append. */
  family(out: Mobject[] = []): Mobject[] {
    perf.count('family()');
    out.push(this);
    for (const c of this.children) c.family(out);
    return out;
  }

  add(...mobs: Mobject[]): this {
    for (const m of mobs) {
      if (m.parent) m.parent.remove(m);
      m.parent = this;
      this.children.push(m);
    }
    this.invalidateBox();
    return this;
  }

  remove(...mobs: Mobject[]): this {
    this.children = this.children.filter((c) => !mobs.includes(c));
    for (const m of mobs) m.parent = null;
    this.invalidateBox();
    return this;
  }

  copy(): this {
    perf.count('copy()');
    const c = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(c, this);
    c.id = nextId++;
    c.parent = null;
    c.style = { ...this.style };
    c.updaters = [];
    c._bbox = null;
    c.copyData(this);
    c.children = this.children.map((ch) => { const cc = ch.copy(); cc.parent = c; return cc; });
    return c;
  }

  /** Deep-copy point data from `src`. Subclasses override. */
  copyData(_src: Mobject): void {}

  // ---- bounding box ------------------------------------------------------

  invalidateBox(): void {
    let m: Mobject | null = this;
    while (m) { m._bbox = null; m = m.parent; }
  }

  /**
   * [minX, minY, maxX, maxY] over the family, or null if empty.
   * Reserved name: assigning `mob.box = ...` would shadow this and break every
   * layout call, so Mobject throws on that assignment (see the setter below).
   */
  box(): Box | null {
    perf.count('box()');
    if (this._bbox) return this._bbox;
    perf.count('box() miss');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of this.family()) {
      for (const a of m.pointArrays()) {
        for (let i = 0; i < a.length; i += 2) {
          const x = a[i]!, y = a[i + 1]!;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (minX === Infinity) return null;
    return (this._bbox = [minX, minY, maxX, maxY]);
  }

  /** Point on the box in `direction`: ORIGIN = center, UR = upper right. */
  boxPoint(direction: Readonly<Vec> = V.ORIGIN): Vec {
    const b = this.box();
    if (!b) return [0, 0];
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const hw = (b[2] - b[0]) / 2, hh = (b[3] - b[1]) / 2;
    return [cx + direction[0] * hw, cy + direction[1] * hh];
  }

  center(): Vec { return this.boxPoint(V.ORIGIN); }
  width(): number { const b = this.box(); return b ? b[2] - b[0] : 0; }
  height(): number { const b = this.box(); return b ? b[3] - b[1] : 0; }
  top(): Vec { return this.boxPoint(V.UP); }
  bottom(): Vec { return this.boxPoint(V.DOWN); }
  left(): Vec { return this.boxPoint(V.LEFT); }
  right(): Vec { return this.boxPoint(V.RIGHT); }

  // ---- transforms --------------------------------------------------------

  /** Map `fn([x,y]) -> [x,y]` over every point, about `aboutPoint` (default: box center). */
  applyPointsFunction(fn: PointsFunction, { aboutPoint = null, aboutEdge = V.ORIGIN }: AboutOpts = {}): this {
    perf.count('applyPointsFunction()');
    const about = aboutPoint ?? this.boxPoint(aboutEdge);
    for (const m of this.family()) {
      for (const a of m.pointArrays()) {
        for (let i = 0; i < a.length; i += 2) {
          const p = fn([a[i]! - about[0], a[i + 1]! - about[1]]);
          a[i] = p[0] + about[0];
          a[i + 1] = p[1] + about[1];
        }
      }
      m.touchPoints();
    }
    this.invalidateBox();
    for (const m of this.family()) m._bbox = null;
    return this;
  }

  /** Hook for subclasses whose derived data depends on points (e.g. Text font size). */
  afterPointsChanged(): void {}

  /**
   * Every in-place write to point arrays must end here. It bumps the points
   * version that render caches key on (array replacement is caught by array
   * identity instead). VMobject.validateCaches = true re-checks every cache
   * hit against the actual points; the test suite runs all scenes that way.
   */
  touchPoints(): void {
    this._pv = (this._pv ?? 0) + 1;
    this.afterPointsChanged();
  }

  /**
   * In-place affine map p -> [a c; b d](p - about) + about + [e f], with no
   * allocation per point (applyPointsFunction allocates two arrays per point).
   */
  applyAffine(a: number, b: number, c: number, d: number, e: number, f: number, { aboutPoint = null, aboutEdge = V.ORIGIN }: AboutOpts = {}): this {
    perf.count('applyAffine()');
    const translation = a === 1 && b === 0 && c === 0 && d === 1;
    const about = translation ? V.ORIGIN : (aboutPoint ?? this.boxPoint(aboutEdge));
    const ox = about[0], oy = about[1];
    const family = this.family();
    for (const m of family) {
      for (const arr of m.pointArrays()) {
        if (translation) {
          for (let i = 0; i < arr.length; i += 2) { arr[i]! += e; arr[i + 1]! += f; }
        } else {
          for (let i = 0; i < arr.length; i += 2) {
            const x = arr[i]! - ox, y = arr[i + 1]! - oy;
            arr[i] = a * x + c * y + ox + e;
            arr[i + 1] = b * x + d * y + oy + f;
          }
        }
      }
      m.touchPoints();
    }
    // Ancestors' boxes depend on siblings too: drop them
    let p = this.parent;
    while (p) { p._bbox = null; p = p.parent; }
    // Boxes are recomputed rather than shifted: points are float32, so a shifted
    // float64 box would drift from a recomputed one in the last bits.
    for (const m of family) m._bbox = null;
    return this;
  }

  shift(v: Readonly<Vec>): this {
    return this.applyAffine(1, 0, 0, 1, v[0], v[1]);
  }

  scale(k: number, opts: AboutOpts = {}): this {
    return this.applyAffine(k, 0, 0, k, 0, 0, opts);
  }

  rotate(angle: number, opts: AboutOpts = {}): this {
    const c = Math.cos(angle), s = Math.sin(angle);
    return this.applyAffine(c, s, -s, c, 0, 0, opts);
  }

  moveTo(target: Readonly<Vec> | Mobject, alignedEdge: Readonly<Vec> = V.ORIGIN): this {
    const dest = target instanceof Mobject ? target.boxPoint(alignedEdge) : target;
    return this.shift(V.sub(dest, this.boxPoint(alignedEdge)));
  }

  /** Place beside `target` in `direction` with a gap of `buff`. */
  nextTo(target: Readonly<Vec> | Mobject, direction: Readonly<Vec> = V.RIGHT, buff = 0.25, alignedEdge: Readonly<Vec> = V.ORIGIN): this {
    const anchor = target instanceof Mobject ? target.boxPoint(direction) : target;
    const mine = this.boxPoint(V.mul(direction, -1));
    // Keep the perpendicular alignment from alignedEdge
    const perp: Vec = [direction[0] === 0 ? alignedEdge[0] : 0, direction[1] === 0 ? alignedEdge[1] : 0];
    const tp = target instanceof Mobject ? target.boxPoint(perp) : anchor;
    const mp = this.boxPoint(perp);
    const shift = V.add(V.sub(anchor, mine), V.mul(direction, buff));
    if (direction[0] === 0) shift[0] = tp[0] - mp[0];
    if (direction[1] === 0) shift[1] = tp[1] - mp[1];
    return this.shift(shift);
  }

  /** Line up with `target`'s edge in `direction` (LEFT: same left edge), leaving the other axis alone. */
  alignTo(target: Readonly<Vec> | Mobject, direction: Readonly<Vec>): this {
    const tp = target instanceof Mobject ? target.boxPoint(direction) : target, mp = this.boxPoint(direction);
    return this.shift([direction[0] ? tp[0] - mp[0] : 0, direction[1] ? tp[1] - mp[1] : 0]);
  }

  toEdge(direction: Readonly<Vec>, buff = 0.5, frame: { w: number; h: number } = { w: 16, h: 9 }): this {
    const edge: Vec = [direction[0] * frame.w / 2, direction[1] * frame.h / 2];
    const mine = this.boxPoint(direction);
    const s = V.sub(edge, mine);
    if (direction[0] === 0) s[0] = 0; else s[0] -= direction[0] * buff;
    if (direction[1] === 0) s[1] = 0; else s[1] -= direction[1] * buff;
    return this.shift(s);
  }

  /**
   * Lay the children out in a row (RIGHT) or column (DOWN), `buff` apart,
   * aligned on `alignedEdge` across the row (e.g. UP for top-aligned), keeping
   * the group's center where it was.
   */
  arrange(direction: Readonly<Vec> = V.RIGHT, buff = 0.25, alignedEdge: Readonly<Vec> = V.ORIGIN): this {
    const c = this.center(), kids = this.children;
    for (let i = 1; i < kids.length; i++) kids[i]!.nextTo(kids[i - 1]!, direction, buff, alignedEdge);
    return this.moveTo(c);
  }

  /**
   * Lay the children out in a grid, row-major, `cols` per row. Cells are as wide
   * as the widest child and as tall as the tallest; children sit centered in them.
   */
  arrangeInGrid(cols: number, { buff = 0.25, buffX = buff, buffY = buff }: { buff?: number; buffX?: number; buffY?: number } = {}): this {
    const c = this.center(), kids = this.children;
    const cw = Math.max(...kids.map((k) => k.width())), ch = Math.max(...kids.map((k) => k.height()));
    kids.forEach((k, i) => k.moveTo([(i % cols) * (cw + buffX), -Math.floor(i / cols) * (ch + buffY)]));
    return this.moveTo(c);
  }

  setWidth(w: number, stretch = false): this {
    const cur = this.width() || 1;
    return stretch ? this.stretch(w / cur, 0) : this.scale(w / cur);
  }

  setHeight(h: number, stretch = false): this {
    const cur = this.height() || 1;
    return stretch ? this.stretch(h / cur, 1) : this.scale(h / cur);
  }

  stretch(k: number, axis: 0 | 1, opts: AboutOpts = {}): this {
    return axis === 0 ? this.applyAffine(k, 0, 0, 1, 0, 0, opts) : this.applyAffine(1, 0, 0, k, 0, 0, opts);
  }

  // ---- style -------------------------------------------------------------

  setStyle(style: Style, recurse = true): this {
    const targets = recurse ? this.family() : [this];
    for (const m of targets) Object.assign(m.style, style);
    return this;
  }
  setFill(fill: string, fillOpacity?: number): this {
    return this.setStyle(fillOpacity == null ? { fill } : { fill, fillOpacity });
  }
  setStroke(stroke: string, strokeWidth?: number, strokeOpacity?: number): this {
    const s: Style = { stroke };
    if (strokeWidth != null) s.strokeWidth = strokeWidth;
    if (strokeOpacity != null) s.strokeOpacity = strokeOpacity;
    return this.setStyle(s);
  }
  setColor(c: string): this { return this.setStyle({ fill: c, stroke: c }); }
  setOpacity(o: number): this { return this.setStyle({ opacity: o }); }

  // ---- interpolation -----------------------------------------------------

  /**
   * Blend this mobject's data between `a` and `b` (same structure) at `alpha`.
   * `a` and `b` are the family members at this one's index, which alignment
   * may have paired with another class (a Rectangle morphing into a Text).
   */
  interpolate(a: Mobject, b: Mobject, alpha: number, pathFunc: PathFunc | null = null): this {
    this.interpolateData(a, b, alpha, pathFunc);
    // Field by field over whatever the style holds: numbers lerp, colors blend
    const mine = this.style as Record<string, string | number | undefined>;
    const sa = a.style as Record<string, string | number | undefined>, sb = b.style as Record<string, string | number | undefined>;
    for (const k in mine) {
      const va = sa[k], vb = sb[k];
      if (va === vb) { mine[k] = va; continue; }
      // Exact at the ends: a + (b - a) * 1 is not always b in floating point
      mine[k] = alpha <= 0 ? va : alpha >= 1 ? vb : COLOR_KEYS.has(k) ? lerpColor(va as string, vb as string, alpha) : (va as number) + ((vb as number) - (va as number)) * alpha;
    }
    this._bbox = null;
    return this;
  }

  /**
   * Blend point arrays, index by index. An array with no counterpart in `b`
   * (a path morphing into a group, which has no points of its own, or into a
   * Text, whose own array is its advance box) collapses toward b's center,
   * as in manim: the shape shrinks away while b's children grow out of the
   * null copies alignment gave this side.
   */
  interpolateData(a: Mobject, b: Mobject, alpha: number, pathFunc: PathFunc | null): void {
    const mine = this.pointArrays(), pa = a.pointArrays(), pb = b.pointArrays();
    let center: Vec | null = null;
    for (let i = 0; i < mine.length; i++) {
      // Alignment gave `a` the same arrays as this one; `b` may lack one
      const m = mine[i]!, x = pa[i]!, y = pb[i];
      if (!y || y.length !== m.length) {
        center ??= b.box() ? b.center() : a.box() ? a.center() : [0, 0];
        for (let j = 0; j < m.length; j += 2) { m[j] = x[j]! + (center[0] - x[j]!) * alpha; m[j + 1] = x[j + 1]! + (center[1] - x[j + 1]!) * alpha; }
        continue;
      }
      if (pathFunc) {
        for (let j = 0; j < m.length; j += 2) {
          const p = pathFunc([x[j]!, x[j + 1]!], [y[j]!, y[j + 1]!], alpha);
          m[j] = p[0]; m[j + 1] = p[1];
        }
      } else if (alpha >= 1) {
        m.set(y);
      } else if (alpha <= 0) {
        m.set(x);
      } else {
        for (let j = 0; j < m.length; j++) m[j] = x[j]! + (y[j]! - x[j]!) * alpha;
      }
    }
    this.touchPoints();
  }

  /**
   * Make this and `other` structurally identical (same family shape, same
   * point counts) so interpolate() is well-defined. Mutates both.
   */
  alignWith(other: Mobject): this {
    perf.count('alignWith()');
    this.alignFamily(other);
    const fa = this.family(), fb = other.family();
    for (let i = 0; i < fa.length; i++) fa[i]!.alignData(fb[i]!);
    return this;
  }

  alignFamily(other: Mobject): void {
    const n = Math.max(this.children.length, other.children.length);
    for (const [m, o] of [[this, other], [other, this]] as const) {
      while (m.children.length < n) {
        // A null child: a point-collapsed copy of the counterpart, so it
        // grows out of / shrinks into something sensible.
        const src = o.children[m.children.length] ?? m;
        const nul = src.nullCopy(m.center());
        m.children.push(nul); nul.parent = m;
      }
    }
    for (let i = 0; i < n; i++) this.children[i]!.alignFamily(other.children[i]!);
  }

  /** Align own point data with `other`. Subclasses override. */
  alignData(_other: Mobject): void {}

  /** A copy with all points collapsed onto `point`, and invisible. */
  nullCopy(point: Readonly<Vec>): this {
    const c = this.copy();
    for (const m of c.family()) {
      for (const a of m.pointArrays()) for (let i = 0; i < a.length; i += 2) { a[i] = point[0]; a[i + 1] = point[1]; }
      m.style.opacity = 0;
      m.touchPoints();
    }
    return c;
  }

  // ---- updaters ----------------------------------------------------------

  addUpdater(fn: Updater<this>): this {
    // Stored with the mobject it runs on, so update() always passes `this`
    this.updaters.push(fn as Updater);
    return this;
  }
  clearUpdaters(): this { this.updaters = []; return this; }
  update(dt: number): this {
    for (const m of this.family()) for (const u of m.updaters) u(m, dt);
    return this;
  }

  // ---- animate builder ---------------------------------------------------

  /**
   * A builder that records method calls (shift, setFill, moveTo, ...) and plays
   * as a Transform to the result of applying them to a copy:
   * `this.play(box.animate.shift(RIGHT))`.
   */
  get animate(): AnimateBuilder<this> {
    const calls: Array<[name: string, args: unknown[]]> = [];
    const mob = this;
    const builder: AnimateBuilderBase<this> = {
      _isAnimateBuilder: true,
      mobject: mob,
      buildTarget() {
        const t = mob.copy();
        // Recorded by name: each one was a function on this mobject when recorded
        for (const [name, args] of calls) (t as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
        return t;
      },
    };
    const proxy: AnimateBuilder<this> = new Proxy(builder, {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        if (typeof mob[prop as keyof typeof mob] === 'function') {
          return (...args: unknown[]) => { calls.push([prop as string, args]); return proxy; };
        }
        return undefined;
      },
    }) as AnimateBuilder<this>;
    return proxy;
  }
}

// Guard the method names scenes most often clobber with ad-hoc properties.
for (const name of ['box', 'center', 'width', 'height', 'left', 'right', 'top', 'bottom'] as const) {
  const method = Mobject.prototype[name];
  Object.defineProperty(Mobject.prototype, name, {
    get() { return method; },
    set() { throw new TypeError(`Mobject.${name} is a method; store your reference under another name (e.g. .rect, .label)`); },
  });
}

/** A mobject with no points of its own; a container. */
export class Group extends Mobject {
  constructor(...mobs: Mobject[]) { super(); this.add(...mobs); }
}
