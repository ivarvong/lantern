// Rendering: a scene becomes a flat list of element records (one per leaf
// mobject, in draw order), which either serializes to an SVG string (no DOM
// needed: Workers, Node, tests) or patches a live DOM (browser).

import { VMobject } from './vmobject.ts';
import type { PathData } from './vmobject.ts';
import type { Mobject, StyleRecord } from './mobject.ts';
import type { Scene, Sink } from './scene.ts';
import { perf } from './perf.ts';

export const FRAME = { w: 16, h: 9 } as const;
/** SVG user units per scene unit: lengths are emitted as integers (see VMobject.formatPathD). */
export const UNITS = 1000;
const VIEWBOX = `${-FRAME.w / 2 * UNITS} ${-FRAME.h / 2 * UNITS} ${FRAME.w * UNITS} ${FRAME.h * UNITS}`;
/** A length in integer user units. */
const len = (x: number): string => '' + Math.round(x * UNITS);

const fmt = (x: number): string => (Math.round(x * 1000) / 1000).toString();

/** SVG attributes, in emission order. */
export type Attrs = Record<string, string>;

/** One drawable element. Never mutated after creation, except to memoize `svg`. */
export interface ElementRecord {
  id: number;
  tag: string;
  attrs: Attrs;
  transform: string | null;
  tx?: number;
  ty?: number;
  text: string | null;
  /** The serialized element, filled in by toSvgString. */
  svg?: string;
}

/** Per-VMobject record memo (VMobject._rec): the style and path it was built from. */
export interface AttrsCache {
  id: number;
  d: string;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  opacity: number;
  drawFraction: number | undefined;
  attrs: Attrs;
  rec: ElementRecord | null;
}

/** Per-group memo for a merged line of glyphs (Mobject._mrec). */
export interface MergedCache {
  id: number;
  pds: Array<PathData | null>;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  opacity: number;
  rec: ElementRecord;
}

/** One record per drawable leaf: { id, tag, attrs, text }. */
export function renderElements(scene: Scene, { relative = true }: { relative?: boolean } = {}): ElementRecord[] {
  return perf.span('render.elements', () => renderElementsImpl(scene, relative));
}
function renderElementsImpl(scene: Scene, relative: boolean): ElementRecord[] {
  const out: ElementRecord[] = [];
  const walk = (m: Mobject): void => {
    // DOM output: a group of same-styled leaves (a line of glyphs) becomes one element
    if (!relative && m.mergeLeaves) {
      const merged = mergedRecord(m);
      if (merged !== undefined) { if (merged) out.push(merged); return; }
    }
    const rec = elementFor(m, relative);
    if (rec) out.push(rec);
    for (const c of m.children) walk(c);
  };
  for (const top of scene.mobjects) walk(top);
  return out;
}

/**
 * Records are memoized per mobject, in two layers:
 *  - `attrs` (path data + style) is reused while the shape string and style
 *    fields are unchanged, and its serialized form is cached alongside;
 *  - the record itself ({ id, tag, attrs, transform }) is reused while the
 *    translation is also unchanged.
 * A rigidly moving path therefore costs one small object and one short string
 * per frame, and an unchanged one costs a few comparisons. Records are never
 * mutated after creation, so they can be kept per frame (see Recording).
 */
function elementFor(m: Mobject, relative: boolean): ElementRecord | null {
  const s = m.style;
  if (s.opacity <= 0) return null;
  if (m instanceof VMobject) {
    if (!m.hasPoints()) return null;
    const pd = m.pathData(relative);
    let k = m._rec;
    if (!(k && k.id === m.id && k.d === pd.d && k.fill === s.fill && k.fillOpacity === s.fillOpacity && k.stroke === s.stroke &&
        k.strokeWidth === s.strokeWidth && k.strokeOpacity === s.strokeOpacity && k.opacity === s.opacity && k.drawFraction === s.drawFraction)) {
      perf.count('attrs miss');
      k = m._rec = { id: m.id, d: pd.d, fill: s.fill, fillOpacity: s.fillOpacity, stroke: s.stroke, strokeWidth: s.strokeWidth, strokeOpacity: s.strokeOpacity, opacity: s.opacity, drawFraction: s.drawFraction, attrs: vmobjectAttrs(m, s, pd), rec: null };
    }
    if (k.rec && k.rec.tx === pd.tx && k.rec.ty === pd.ty) { perf.count('element hit'); return k.rec; }
    perf.count('element moved');
    return (k.rec = { id: m.id, tag: 'path', attrs: k.attrs, transform: pd.tx || pd.ty ? 'translate(' + pd.tx + ' ' + pd.ty + ')' : null, tx: pd.tx, ty: pd.ty, text: null });
  }
  return null;
}

/**
 * One <path> for a group whose leaves all share a style: the leaves' path data
 * concatenated. Per-element costs in the browser (style recalc, layout, paint
 * invalidation) scale with element count, and the playback trace showed every
 * late frame was one writing hundreds of glyph elements at once: a code block
 * fading in (740 attribute writes per frame) or morphing (317). A line of glyphs
 * almost always shares one style, so this is one element per line. Returns
 * undefined when the leaves' styles differ (letter-by-letter Write) so the
 * caller falls back to one element per leaf, null when nothing is visible.
 */
function mergedRecord(g: Mobject): ElementRecord | null | undefined {
  const kids = g.children;
  let s0: StyleRecord | null = null;
  for (const c of kids) {
    if (!(c instanceof VMobject) || c.children.length) return undefined;
    const s = c.style;
    if (s.drawFraction != null) return undefined;
    if (!s0) { s0 = s; continue; }
    if (s.fill !== s0.fill || s.fillOpacity !== s0.fillOpacity || s.stroke !== s0.stroke || s.strokeWidth !== s0.strokeWidth ||
        s.strokeOpacity !== s0.strokeOpacity || s.opacity !== s0.opacity) return undefined;
  }
  if (!s0 || s0.opacity <= 0) return null;
  // Every child is a VMobject: the loop above returned otherwise
  const pds = (kids as VMobject[]).map((c) => (c.hasPoints() ? c.pathData(false) : null));
  const k = g._mrec;
  if (k && k.id === g.id && k.pds.length === pds.length && k.pds.every((p, i) => p === pds[i]) && k.fill === s0.fill &&
      k.fillOpacity === s0.fillOpacity && k.stroke === s0.stroke && k.strokeWidth === s0.strokeWidth && k.strokeOpacity === s0.strokeOpacity && k.opacity === s0.opacity) {
    perf.count('merged hit');
    return k.rec;
  }
  perf.count('merged miss');
  const d = pds.map((p) => (p ? p.d : '')).join('');
  const rec: ElementRecord = { id: g.id, tag: 'path', attrs: vmobjectAttrs(kids[0] as VMobject, s0, { d }), transform: null, text: null };
  g._mrec = { id: g.id, pds, fill: s0.fill, fillOpacity: s0.fillOpacity, stroke: s0.stroke, strokeWidth: s0.strokeWidth, strokeOpacity: s0.strokeOpacity, opacity: s0.opacity, rec };
  return rec;
}

function vmobjectAttrs(m: VMobject, s: StyleRecord, pd: { d: string }): Attrs {
  {
    const attrs: Attrs = {
      d: pd.d,
      fill: s.fill,
      'fill-opacity': fmt(s.fillOpacity),
    };
    // stroke="none" with a stroke-width still paints a hairline in WebKit, which
    // reads as a second, softer copy of every glyph. Omit the stroke paint entirely.
    if (s.stroke !== 'none') {
      attrs.stroke = s.stroke;
      attrs['stroke-width'] = len(s.strokeWidth);
      attrs['stroke-opacity'] = fmt(s.strokeOpacity);
      attrs['stroke-linejoin'] = 'round';
      attrs['stroke-linecap'] = 'round';
    } else attrs.stroke = 'none';
    if (s.opacity < 1) attrs.opacity = fmt(s.opacity);
    if (s.drawFraction != null && s.drawFraction < 1) {
      const L = perf.span('arcLength', () => m.arcLength()) + 0.001;
      attrs['stroke-dasharray'] = len(L);
      attrs['stroke-dashoffset'] = len(L * (1 - s.drawFraction));
    }
    return attrs;
  }
}


const ESC = /[&<>"]/;
const esc = (v: unknown): string => {
  const str = String(v);
  // Most values (numbers, colors, path data) contain nothing to escape: one test, no allocation
  return ESC.test(str) ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : str;
};

const attrStrings = new WeakMap<Attrs, string>(); // attrs object -> ' k="v" ...'
function serializeAttrs(attrs: Attrs): string {
  let s = attrStrings.get(attrs);
  if (s === undefined) {
    s = '';
    for (const k in attrs) s += ` ${k}="${esc(attrs[k])}"`;
    attrStrings.set(attrs, s);
  }
  return s;
}
function serializeElement(el: ElementRecord): string {
  const t = el.transform ? ` transform="${el.transform}"` : '';
  return `<${el.tag}${t}${serializeAttrs(el.attrs)}` + (el.text == null ? '/>' : `>${esc(el.text)}</${el.tag}>`);
}

export interface SvgOptions {
  /** Pixel width; height follows the 16:9 frame. */
  width?: number;
  background?: string;
}

export function toSvgString(scene: Scene, { width = 1280, background = '#1a1a1a' }: SvgOptions = {}): string {
  const height = Math.round(width * FRAME.h / FRAME.w);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${VIEWBOX}">`;
  s += `<rect x="${-FRAME.w / 2 * UNITS}" y="${-FRAME.h / 2 * UNITS}" width="${FRAME.w * UNITS}" height="${FRAME.h * UNITS}" fill="${background}"/>`;
  const els = renderElements(scene);
  const end = perf.begin('render.serialize');
  const parts = [s];
  for (const el of els) parts.push(el.svg ??= serializeElement(el));
  parts.push('</svg>');
  end();
  return parts.join('');
}

// ---- sinks ---------------------------------------------------------------

/** Collects every frame as an SVG string. Works anywhere JS runs. */
export class StringSink implements Sink {
  opts: SvgOptions;
  frames: string[];
  constructor(opts: SvgOptions = {}) { this.opts = opts; this.frames = []; }
  async frame(scene: Scene): Promise<void> { this.frames.push(toSvgString(scene, this.opts)); }
  last(): string | undefined { return this.frames[this.frames.length - 1]; }
}

/** Keeps only the latest frame; cheap when you only want a snapshot. */
export class SnapshotSink implements Sink {
  opts: SvgOptions;
  svg: string;
  constructor(opts: SvgOptions = {}) { this.opts = opts; this.svg = ''; }
  async frame(scene: Scene): Promise<void> { this.svg = toSvgString(scene, this.opts); }
}

/** DomSink's per-element state: the live node and what was last written to it. */
interface DomNode {
  el: Element;
  attrs: Attrs;
  text: string | null;
  rec: ElementRecord | null;
  transform?: string | null;
  attrsRef?: Attrs;
}

/** Opt-in frame logs that tools/playback.ts and tools/hitch.ts install on the page. */
const logs = globalThis as { __frameLog?: number[]; __mutLog?: number[] };

/**
 * Patches a live <svg> in place: one stable element per mobject, attributes
 * diffed, elements reordered only when draw order changes. Paces frames to
 * real time with requestAnimationFrame.
 */
export class DomSink implements Sink {
  doc: Document;
  svg: SVGSVGElement;
  NS: 'http://www.w3.org/2000/svg';
  nodes: Map<number, DomNode>;
  realtime: boolean;
  anchor: number | null;
  lastPatch: number;
  dropped: number;
  maxFreezeMs: number;

  constructor(container: Element, { background = '#1a1a1a', realtime = true }: { background?: string; realtime?: boolean } = {}) {
    const NS = 'http://www.w3.org/2000/svg';
    // A container in a live document always has one
    this.doc = container.ownerDocument!;
    this.svg = this.doc.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', VIEWBOX);
    this.svg.style.background = background;
    this.svg.style.width = '100%';
    this.svg.style.display = 'block';
    container.appendChild(this.svg);
    this.NS = NS;
    this.nodes = new Map(); // mobject id -> { el, attrs, text }
    this.realtime = realtime;
    this.anchor = null;
    this.lastPatch = 0;
    this.dropped = 0;
    this.maxFreezeMs = 100;
  }

  /**
   * Real-time pacing, driven by requestAnimationFrame against a wall-clock
   * schedule (scene time t is due at anchor + t). Each frame is patched in the
   * animation frame it's due in, so frames land on vsync; when the scene falls
   * more than a frame behind, that frame's DOM patch is dropped instead of
   * slowing playback, but never for longer than maxFreezeMs. A stall longer
   * than 250ms (a pause, a hidden tab) re-anchors the schedule.
   */
  async frame(scene: Scene, dt = 0): Promise<void> {
    if (!this.realtime || dt === 0) { this.anchor = null; this.patch(scene, performance.now()); return; }
    const now = performance.now();
    if (this.anchor != null && now - (this.anchor + scene.time * 1000) > 250) this.anchor = null;
    if (this.anchor != null && now > this.anchor + scene.time * 1000 + dt * 1000 && now - this.lastPatch < this.maxFreezeMs) {
      this.dropped++; perf.count('frames dropped');
      return;
    }
    // Decide on the rAF timestamp (the vsync time), not performance.now() inside the
    // callback: callback delay is noisy, and near a vsync boundary that noise flips
    // frames between 1 and 3 vsyncs (16/50 ms judder at a 33 ms cadence).
    for (;;) {
      const vsync = await nextAnimationFrame();
      if (this.anchor == null) this.anchor = vsync - scene.time * 1000;
      if (vsync >= this.anchor + scene.time * 1000 - 8) { this.patch(scene, vsync); return; }
    }
  }

  patch(scene: Scene, presentAt: number): void {
    // Absolute path data: measured faster for live DOM patching than translate + relative
    this.apply(renderElements(scene, { relative: false }), presentAt, scene.time);
  }

  /** Bring the DOM to exactly these records (one frame). */
  apply(els: readonly ElementRecord[], presentAt: number, t: number): void {
    this.lastPatch = performance.now();
    let muts = 0, dMuts = 0;
    const end = perf.begin('dom.patch');
    const seen = new Set<number>();
    let cursor = this.svg.firstChild;
    for (const rec of els) {
      seen.add(rec.id);
      let node = this.nodes.get(rec.id);
      if (!node || node.el.tagName !== rec.tag) {
        if (node) node.el.remove();
        const el = this.doc.createElementNS(this.NS, rec.tag);
        node = { el, attrs: {}, text: null, rec: null };
        this.nodes.set(rec.id, node);
      }
      // Records are memoized: the same object means nothing about this element changed
      if (node.rec === rec) {
        if (node.el !== cursor) this.svg.insertBefore(node.el, cursor);
        else cursor = cursor.nextSibling;
        continue;
      }
      node.rec = rec;
      if (rec.transform !== node.transform) {
        if (rec.transform) node.el.setAttribute('transform', rec.transform); else node.el.removeAttribute('transform');
        muts++;
        node.transform = rec.transform;
      }
      // Same attrs object: only the transform can have changed
      if (node.attrsRef === rec.attrs) {
        if (node.el !== cursor) this.svg.insertBefore(node.el, cursor);
        else cursor = cursor.nextSibling;
        continue;
      }
      node.attrsRef = rec.attrs;
      for (const k in rec.attrs) {
        const v = rec.attrs[k]!;
        if (node.attrs[k] !== v) { node.el.setAttribute(k, v); node.attrs[k] = v; muts++; if (k === 'd') dMuts++; }
      }
      for (const k in node.attrs) {
        if (!(k in rec.attrs)) { node.el.removeAttribute(k); delete node.attrs[k]; }
      }
      if (rec.text !== node.text) { node.el.textContent = rec.text ?? ''; node.text = rec.text; }
      // Keep document order equal to draw order with minimal moves
      if (node.el !== cursor) this.svg.insertBefore(node.el, cursor);
      else cursor = cursor.nextSibling;
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) { node.el.remove(); this.nodes.delete(id); }
    }
    end();
    // Opt-in frame log for the playback verifier (tools/playback.ts)
    logs.__frameLog?.push(presentAt, t);
    // Opt-in per-frame detail for tools/hitch.ts: attribute writes, of which path data
    logs.__mutLog?.push(muts, dMuts, -1);
  }

}

const nextAnimationFrame = (): Promise<number> => new Promise((res) => requestAnimationFrame(res));
