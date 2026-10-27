// Text: real glyph outlines from the embedded fonts, one VMobject per glyph.
//
// Exact advances for layout, letter-by-letter Write, and Transform between
// strings morphs glyph to glyph. The DOM renderer draws a same-styled line as
// one <path> (mergedRecord in svg.ts), so a line costs one element.
//
//   new Text('hello', { fontSize: 0.4, font: 'sans' | 'mono', color, weight: 'normal' | 'bold',
//                       anchor: 'start' | 'middle' | 'end' })
//
// `anchor` is the point setText() keeps fixed: a left-anchored counter going
// 10.0 -> 9.0 stays put at its left edge. Fonts are loaded by Scene.run();
// outside a scene, await loadFonts() first.

import { Mobject, Group } from './mobject.ts';
import type { Style, PathFunc } from './mobject.ts';
import { VMobject } from './vmobject.ts';
import { Rectangle } from './shapes.ts';
import { shaperFor } from './fonts.ts';
import type { FontName } from './fonts.ts';
import { WHITE } from './color.ts';
import type { Vec } from './vec.ts';
import type { Segment } from '../vendor/glyph.js';

export interface TextOpts {
  fontSize?: number;
  font?: FontName;
  color?: string;
  weight?: 'normal' | 'bold';
  /** The point setText() keeps fixed. */
  anchor?: 'start' | 'middle' | 'end';
  fillOpacity?: number;
}

/** A glyph outline as cubic subpaths in font units, before placement. */
interface UnitOutline { subpaths: number[][]; closed: boolean[] }

/**
 * A glyph outline flattened once to cubic Bézier subpaths in font units (y-up),
 * keyed by the shaper's segment array. Shaping is memoized, so the same glyph
 * reuses this; each Glyph is then one affine map into a Float32Array.
 */
const unitOutlines = new WeakMap<Segment[], UnitOutline>();
function unitOutline(segments: Segment[]): UnitOutline {
  let o = unitOutlines.get(segments);
  if (o) return o;
  const subpaths: number[][] = [], closed: boolean[] = [];
  // The shaper always opens a contour with MoveTo before drawing into it
  let cur: number[] = [], cx = 0, cy = 0;
  for (const s of segments) {
    switch (s.tag) {
      case 'MoveTo': cur = [s.x, s.y]; subpaths.push(cur); closed.push(false); cx = s.x; cy = s.y; break;
      case 'LineTo':
        cur.push(cx + (s.x - cx) / 3, cy + (s.y - cy) / 3, cx + 2 * (s.x - cx) / 3, cy + 2 * (s.y - cy) / 3, s.x, s.y);
        cx = s.x; cy = s.y; break;
      case 'QuadTo':
        // Degree elevation: cubic handles 2/3 of the way toward the quad control
        cur.push(cx + 2 * (s.x1 - cx) / 3, cy + 2 * (s.y1 - cy) / 3, s.x + 2 * (s.x1 - s.x) / 3, s.y + 2 * (s.y1 - s.y) / 3, s.x, s.y);
        cx = s.x; cy = s.y; break;
      case 'CubicTo': cur.push(s.x1, s.y1, s.x2, s.y2, s.x, s.y); cx = s.x; cy = s.y; break;
      case 'Close': if (closed.length) closed[closed.length - 1] = true; break;
    }
  }
  o = { subpaths, closed };
  unitOutlines.set(segments, o);
  return o;
}

class Glyph extends VMobject {
  /** Source string index this glyph came from. */
  cluster: number | undefined;
  constructor(segments: Segment[], scale: number, ox: number, oy: number, style: Style) {
    super(style);
    const { subpaths, closed } = unitOutline(segments);
    this.subpaths = subpaths.map((u) => {
      const a = new Float32Array(u.length);
      // Font units are y-up, like the scene: one scale and offset, no flip
      for (let i = 0; i < u.length; i += 2) { a[i] = ox + u[i]! * scale; a[i + 1] = oy + u[i + 1]! * scale; }
      return a;
    });
    this.closed = closed.slice();
  }
}

// Faux bold: an outline in the fill color, this fraction of the font size wide
// (only Regular faces are embedded).
const BOLD_STROKE = 0.045;

/** A shaped run's metrics, in scene units at `fontSize`. */
export interface RunMetrics { width: number; ascent: number; descent: number; fontSize: number }

export class Text extends Group {
  text: string;
  font: FontName;
  fontSize: number;
  weight: 'normal' | 'bold';
  anchor: 'start' | 'middle' | 'end';
  // Set by build(), which the constructor calls
  run!: RunMetrics;
  /** The advance box as a point array [x0, y0, x1, y1]: see build(). */
  frameBox!: Float32Array;

  constructor(text: string, { fontSize = 0.4, font = 'sans', color = WHITE, weight = 'normal', anchor = 'middle', fillOpacity = 1 }: TextOpts = {}) {
    super();
    this.text = text;
    this.font = font;
    this.fontSize = fontSize;
    this.weight = weight;
    this.anchor = anchor;
    this.mergeLeaves = true;
    const bold = weight === 'bold';
    this.build(text, fontSize, {
      fill: color, fillOpacity, stroke: bold ? color : 'none', strokeWidth: bold ? BOLD_STROKE * fontSize : 0,
    });
    // Center the advance box on the origin, like every other mobject.
    // build() leaves the baseline on y = 0 and the box at [0, -descent, width, ascent],
    // so the typographic center sits (ascent - descent) / 2 above the origin.
    // Scene glyphs are the embedded faces (see fonts.ts), not a DOM webfont:
    // a face that fails to load on iOS never substitutes system metrics here,
    // and nothing in this path uses dominant-baseline, alignment-baseline, or foreignObject.
    this.shift([-this.run.width / 2, -(this.run.ascent - this.run.descent) / 2]);
  }

  /** Lay out glyphs with the pen at the origin and the baseline at y = 0. */
  build(text: string, fontSize: number, style: Style): void {
    const run = shaperFor(this.font)(text, fontSize);
    this.run = { width: run.width, ascent: run.ascent, descent: run.descent, fontSize };
    const scale = run.s ?? fontSize / 1000;
    for (const c of this.children) c.parent = null;
    this.children = [];
    for (const g of run.glyphs) {
      if (!g.path?.length) continue;
      const gl = new Glyph(g.path, g.s ?? scale, g.x + g.dx, g.dy, { ...style });
      gl.cluster = g.cluster;
      gl.parent = this;
      this.children.push(gl);
    }
    // The advance box travels with the glyphs as a point array of its own, so
    // box()/left() are typographic extents (leading spaces count), not ink.
    this.frameBox = new Float32Array([0, -run.descent, run.width, run.ascent]);
    this.invalidateBox();
  }

  override pointArrays(): Float32Array[] { return [this.frameBox]; }
  override copyData(src: Mobject): void { this.frameBox = new Float32Array((src as Text).frameBox); }

  /** Exact advance width, in scene units. */
  advance(): number { return this.frameBox[2]! - this.frameBox[0]!; }

  /** The point setText keeps fixed: left, center or right of the advance box, at its vertical middle. */
  anchorPoint(): Vec {
    const f = this.frameBox, cy = (f[1]! + f[3]!) / 2;
    return [this.anchor === 'start' ? f[0]! : this.anchor === 'end' ? f[2]! : (f[0]! + f[2]!) / 2, cy];
  }

  /** Replace the text, keeping the anchor point, current size (after any scaling) and current style. */
  setText(text: string): this {
    const at = this.anchorPoint();
    const size = this.run.fontSize * (this.frameBox[3]! - this.frameBox[1]!) / (this.run.ascent + this.run.descent);
    const style: Style = this.children[0] ? { ...this.children[0].style } : { fill: WHITE, stroke: 'none' };
    this.text = text;
    this.build(text, size, style);
    const now = this.anchorPoint();
    this.shift([at[0] - now[0], at[1] - now[1]]);
    return this;
  }

  override setFill(fill: string, fillOpacity?: number): this {
    super.setFill(fill, fillOpacity);
    if (this.weight === 'bold') this.setStyle({ stroke: fill });
    return this;
  }

  /** Glyphs morph pairwise (Transform aligns them); the string itself switches when the morph lands. */
  override interpolate(a: Mobject, b: Mobject, alpha: number, pathFunc?: PathFunc | null): this {
    super.interpolate(a, b, alpha, pathFunc);
    if (alpha >= 1 && b instanceof Text) { this.text = b.text; this.run = b.run; }
    return this;
  }
}

export interface DecimalNumberOpts extends TextOpts { decimals?: number; prefix?: string; suffix?: string }

/** A number that animates: Transform blends `value`; the glyphs are re-shaped each frame. */
export class DecimalNumber extends Text {
  value: number;
  decimals: number;
  prefix: string;
  suffix: string;

  constructor(value: number, { decimals = 0, prefix = '', suffix = '', ...opts }: DecimalNumberOpts = {}) {
    super(DecimalNumber.format(value, decimals, prefix, suffix), opts);
    this.value = value; this.decimals = decimals; this.prefix = prefix; this.suffix = suffix;
  }
  static format(v: number, d: number, pre: string, suf: string): string { return pre + v.toFixed(d) + suf; }
  setValue(v: number): this {
    this.value = v;
    return this.setText(DecimalNumber.format(v, this.decimals, this.prefix, this.suffix));
  }
  override interpolate(a: Mobject, b: Mobject, alpha: number, pathFunc?: PathFunc | null): this {
    // Alignment pairs family members by index, so either side may be another
    // class; its `value` is then undefined and the plain blend runs
    const va = (a as Partial<DecimalNumber>).value, vb = (b as Partial<DecimalNumber>).value;
    if (va === vb) return super.interpolate(a, b, alpha, pathFunc);
    Mobject.prototype.interpolate.call(this, a, b, alpha, pathFunc);
    return this.setValue(va! + (vb! - va!) * alpha);
  }
}

export interface CodeOpts { fontSize?: number; color?: string; lineHeight?: number }

/** Monospace lines, left-aligned on exact advances. */
export class Code extends Group {
  lines: Text[];

  constructor(lines: readonly string[], { fontSize = 0.26, color = '#dddddd', lineHeight = 1.5 }: CodeOpts = {}) {
    super();
    this.lines = lines.map((l, i) => {
      const t = new Text(l, { fontSize, font: 'mono', color, anchor: 'start' });
      t.shift([-t.frameBox[0]!, -i * fontSize * lineHeight - t.anchorPoint()[1]]);
      return t;
    });
    this.add(...this.lines);
    this.moveTo([0, 0]);
  }
  /** A translucent bar behind line `i`, as wide as the block. */
  highlight(i: number, color = '#ffff00'): Rectangle {
    const r = new Rectangle({ width: this.width() + 0.3, height: this.lines[i]!.height() * 1.45, cornerRadius: 0.06, fill: color, fillOpacity: 0.18, stroke: 'none' });
    return r.moveTo(this.lineCenter(i));
  }
  /** Where a highlight bar for line `i` sits. */
  lineCenter(i: number): Vec { return [this.center()[0], this.lines[i]!.center()[1]]; }
}
