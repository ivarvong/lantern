// Text renderer: a frame as a monospace character grid. Lossy on purpose;
// it exists so an agent (or a terminal) can read a frame without a browser:
// where things are, what is connected, which code line is lit.

import { VMobject } from './vmobject.ts';
import type { Mobject } from './mobject.ts';
import { Arrow, CurvedArrow, Circle, Dot } from './shapes.ts';
import { Text } from './text.ts';
import { FRAME } from './svg.ts';
import type { Scene, Sink, Step } from './scene.ts';
import type { VecLike } from './vec.ts';

export interface TextGridOptions { cols?: number; rows?: number }

export function renderText(scene: Scene, { cols = 96, rows }: TextGridOptions = {}): string {
  const frame = scene.frame ?? FRAME;
  // The 16:9 default stays 96×27 so existing text dumps do not change shape.
  const rowCount = rows ?? (frame.w === FRAME.w && frame.h === FRAME.h ? 27 : Math.max(12, Math.round(cols * frame.h / frame.w)));
  const grid = Array.from({ length: rowCount }, () => new Array<string>(cols).fill(' '));
  const sx = cols / frame.w, sy = rowCount / frame.h;
  const X = (x: number) => Math.round((x + frame.w / 2) * sx);
  const Y = (y: number) => Math.round((frame.h / 2 - y) * sy); // model y is up; rows go down
  const put = (c: number, r: number, ch: string) => { if (r >= 0 && r < rowCount && c >= 0 && c < cols) grid[r]![c] = ch; };
  const visible = (m: Mobject) => m.style.opacity > 0.05;

  // Only called on mobjects with points, so the box exists
  const box = (m: Mobject, round: boolean) => {
    const [x0, y0, x1, y1] = m.box()!;
    const c0 = X(x0), c1 = Math.max(X(x1), c0 + 1), r0 = Y(y1), r1 = Math.max(Y(y0), r0 + 1);
    if (r1 - r0 < 2) { for (let c = c0; c <= c1; c++) put(c, r0, '─'); return; }
    const [tl, tr, bl, br] = round ? ['╭', '╮', '╰', '╯'] as const : ['┌', '┐', '└', '┘'] as const;
    for (let c = c0 + 1; c < c1; c++) { put(c, r0, '─'); put(c, r1, '─'); }
    for (let r = r0 + 1; r < r1; r++) { put(c0, r, '│'); put(c1, r, '│'); }
    put(c0, r0, tl); put(c1, r0, tr); put(c0, r1, bl); put(c1, r1, br);
  };

  const line = (a: VecLike, b: VecLike, head: boolean) => {
    const c0 = X(a[0]!), r0 = Y(a[1]!), c1 = X(b[0]!), r1 = Y(b[1]!);
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1);
    const dc = c1 - c0, dr = r1 - r0;
    const ch = Math.abs(dc) > 2 * Math.abs(dr) ? '─' : Math.abs(dr) > 2 * Math.abs(dc) ? '│' : (dc > 0) === (dr > 0) ? '╲' : '╱';
    for (let i = 0; i <= n; i++) put(Math.round(c0 + dc * i / n), Math.round(r0 + dr * i / n), ch);
    if (head) put(c1, r1, Math.abs(dc) >= Math.abs(dr) ? (dc > 0 ? '▶' : '◀') : (dr > 0 ? '▼' : '▲'));
  };

  // Three passes so labels and arrows land on top of box borders
  const later: Mobject[] = [];
  const draw = (m: Mobject, pass = 0): void => {
    if (!visible(m)) return;
    if (pass === 0 && (m instanceof Arrow || m instanceof CurvedArrow || m instanceof Text || m instanceof Dot)) { later.push(m); return; }
    if (m instanceof Arrow) { line(m.line.start(), m.tip.subpaths[0]!.slice(0, 2), true); return; }
    if (m instanceof CurvedArrow) {
      const a = m.arc, n = a.numCurves(0);
      let prev = a.pointOnCurve(0, 0, 0);
      for (let c = 0; c < n; c++) for (let s = 1; s <= 4; s++) { const p = a.pointOnCurve(0, c, s / 4); line(prev, p, false); prev = p; }
      line(prev, m.tip.subpaths[0]!.slice(0, 2), true);
      return;
    }
    if (m instanceof Text) {
      if (!m.text) return;
      const c = m.anchor === 'start' ? X(m.left()[0]) : m.anchor === 'end' ? X(m.right()[0]) - m.text.length : X(m.center()[0]) - Math.floor(m.text.length / 2);
      const r = Y(m.center()[1]);
      for (let i = 0; i < m.text.length; i++) put(c + i, r, m.text[i]!);
      return;
    }
    if (m instanceof VMobject && m.hasPoints()) {
      const s = m.style;
      if (m instanceof Dot) { put(X(m.center()[0]), Y(m.center()[1]), '●'); return; }
      if (s.stroke === 'none' && s.fill !== 'none') {
        // A fill-only rectangle is a highlight: mark its rows at the left edge
        const [x0, y0, x1, y1] = m.box()!;
        if (x1 - x0 > 2 * (y1 - y0)) { for (let r = Y(y1); r <= Y(y0); r++) put(X(x0), r, '▌'); return; }
      }
      box(m, m instanceof Circle);
      return;
    }
    for (const ch of m.children) draw(ch);
  };

  for (const top of scene.mobjects) draw(top, 0);
  const order = (m: Mobject) => (m instanceof Text ? 2 : m instanceof Dot ? 3 : 1);
  for (const m of later.sort((a, b) => order(a) - order(b))) draw(m, 1);
  return grid.map((r) => r.join('').replace(/\s+$/, '')).join('\n');
}

/** Collects a text frame at each step boundary (and the final frame). */
export class TextSink implements Sink {
  opts: TextGridOptions;
  frames: Array<{ step: string; t: number; text: string }>;
  last?: Scene;
  constructor(opts: TextGridOptions = {}) { this.opts = opts; this.frames = []; }
  async frame(scene: Scene): Promise<void> { this.last = scene; }
  async stepBegin(scene: Scene, s: Step): Promise<void> { this.frames.push({ step: s.path, t: scene.time, text: renderText(scene, this.opts) }); }
}
