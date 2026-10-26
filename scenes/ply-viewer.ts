// ply /view, on a phone canvas.
//
// The public viewer is moving from ivarvong/ply to ivarvong/ply-web. ply-web has
// no commits yet, so every quoted line is from ivarvong/ply pull/2 at
// 3f07a75c667ab8afad9e91d396836eb21abb1b8f. The page stays
// ply.ivar.workers.dev/view.
//
// The camera is the 390×844 phone, not a 16:9 stage letterboxed onto one.
// Code sits at the top, one picture fills the middle, the trace sits on the bottom.
// The gap between those bands stays under PHONE_BAND_GAP (48px at 390 wide).
// Colors are the concept, on every pane:
//   host / ls-refs / blob:none retry = teal,  tree / tree:0 = green,
//   commit / offset = blue,  ref-delta = red,  credential = orange,
//   blob bytes = grey,  pkt length / span = gold,  HTTP 400 = red.
import {
  Scene, Group, Text, Rectangle, Line, CurvedArrow, FadeIn, FadeOut, Create, Transform, LaggedStart,
  linear, LEFT, RIGHT, UL, PHONE_BAND_GAP,
  BLUE, TEAL, GREEN, RED, GREY, WHITE, ORANGE, GOLD,
} from '../src/index.ts';
import type { Sink, SceneOptions, Mobject } from '../src/index.ts';

const INK = '#d8d8d8';
const DIM = '#8d8d8d';
/** Phone camera. 16 scene units across, so a 0.7 glyph is about 17px at 390. */
const PHONE_W = 16;
const PHONE_H = PHONE_W * (844 / 390);
const FS = 0.62;
const MAX_W = 13.15;
const INK_LEFT = -7.15;
const ELL = '...';

// test/fixtures/viewer/small.pack (930 B). Not octocat/Hello-World's HEAD.
const PACK: ReadonlyArray<readonly [off: number, len: number, fill: string]> = [
  [0, 12, '#5c5c5c'],
  [12, 371, BLUE],
  [383, 183, RED],
  [566, 108, GREEN],
  [674, 15, GREY],
  [689, 27, GREY],
  [716, 43, GREEN],
  [759, 16, GREY],
  [775, 108, GREEN],
  [883, 27, GREY],
  [910, 20, '#5c5c5c'],
];
const PACK_BYTES = 930;

/**
 * pkt() in src/pktline.js: 4 hex digits plus the payload bytes. Callers pass
 * the trailing newline inside the payload (`command=ls-refs\n`), and the
 * length counts it. The newline is not drawn.
 */
function pktLine(payload: string): { hex: string; body: string } {
  const hex = (payload.length + 4).toString(16).padStart(4, '0');
  return { hex, body: payload.replace(/\n$/, '') };
}

function mono(text: string, fontSize: number, color: string, anchor: 'start' | 'middle' | 'end' = 'middle'): Text {
  return new Text(text, { font: 'mono', fontSize, color, anchor });
}

function widthOf(text: string, fontSize: number): number {
  return mono(text, fontSize, INK, 'start').advance();
}

/** Largest size at which `text` still fits the phone width. */
function fitSize(text: string, maxW: number, cap: number): number {
  const w = widthOf(text, 1);
  if (w < 1e-6) return cap;
  return Math.min(cap, maxW / w);
}

function atomsOf(span: string, token: string): string[] {
  const i = span.indexOf(token);
  const out: string[] = [];
  const eat = (s: string): void => {
    for (const b of s.split(/(\s+)/)) if (b !== '') out.push(b);
  };
  eat(span.slice(0, i));
  out.push(token);
  eat(span.slice(i + token.length));
  return out;
}

function joinAtoms(parts: string[]): string {
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Break a source line into rows that fit the phone, keeping `token` whole. */
function fitCode(source: string, token: string, fs: number, maxW: number): string[] {
  const at = source.indexOf(token);
  if (at < 0) throw new Error(`missing token ${JSON.stringify(token)} in ${JSON.stringify(source)}`);
  const span = source.trim();
  const atoms = atomsOf(span, token);
  const rows: string[][] = [];
  let cur: string[] = [];
  const wide = (parts: string[]) => widthOf(joinAtoms(parts), fs) > maxW;
  for (const a of atoms) {
    if (cur.length && wide(cur.concat(a))) { rows.push(cur); cur = [a]; }
    else cur = cur.concat(a);
  }
  if (cur.length) rows.push(cur);
  let lines = rows.map((parts) => joinAtoms(parts));
  if (lines.length > 3) {
    const k = Math.max(0, lines.findIndex((l) => l.includes(token)));
    const from = Math.max(0, Math.min(k - 1, lines.length - 3));
    const slice = lines.slice(from, from + 3);
    if (from > 0) slice[0] = shrinkLine(ELL + slice[0]!, token, fs, maxW);
    if (from + 3 < lines.length) slice[slice.length - 1] = shrinkLine(slice[slice.length - 1] + ELL, token, fs, maxW);
    lines = slice;
  }
  for (const line of lines) {
    if (widthOf(line, fs) > maxW + 0.05) throw new Error(`code wider than the phone (${widthOf(line, fs).toFixed(2)}): ${line}`);
  }
  if (!lines.some((l) => l.includes(token))) throw new Error(`token dropped from ${source}`);
  return lines;
}

function shrinkLine(line: string, token: string, fs: number, maxW: number): string {
  const form = (lo: number, hi: number): string => {
    const cutL = lo > 0, cutR = hi < line.length;
    return (cutL ? ELL : '') + line.slice(lo, hi).trim() + (cutR ? ELL : '');
  };
  if (widthOf(line, fs) <= maxW) return line;
  const i = line.indexOf(token);
  if (i < 0) {
    let hi = line.length;
    while (hi > 4 && widthOf(form(0, hi), fs) > maxW) hi -= 2;
    return form(0, hi);
  }
  let lo = 0, hi = line.length;
  while (widthOf(form(lo, hi), fs) > maxW && (lo < i || hi > i + token.length)) {
    const right = hi - (i + token.length);
    const left = i - lo;
    if (hi > i + token.length && right >= left) hi--;
    else if (lo < i) lo++;
    else break;
  }
  const s = form(lo, hi);
  return widthOf(s, fs) <= maxW + 0.05 ? s : token;
}

function buildLine(source: string, token: string, color: string, top: number): { group: Group; token: Text } {
  const lines = fitCode(source, token, FS, MAX_W);
  const rows: Group[] = [];
  let tok: Text | null = null;
  let y = 0;
  for (const line of lines) {
    const i = line.indexOf(token);
    const parts: Text[] = [];
    if (i < 0) parts.push(mono(line, FS, DIM, 'start'));
    else {
      if (i > 0) parts.push(mono(line.slice(0, i), FS, DIM, 'start'));
      const t = mono(token, FS, color, 'start');
      parts.push(t);
      tok = t;
      const rest = line.slice(i + token.length);
      if (rest) parts.push(mono(rest, FS, DIM, 'start'));
    }
    let x = 0;
    for (const p of parts) { p.moveTo([x, 0], LEFT); x += p.advance(); }
    const row = new Group(...parts);
    row.moveTo([INK_LEFT, y], LEFT);
    rows.push(row);
    // Room for a connector to leave between wrapped lines. Clearance on both
    // sides is wider than the old 1.05 pitch, so the route fell through the type.
    y -= 1.28;
  }
  if (!tok) throw new Error(`token ${token} missing after layout`);
  const group = new Group(...rows);
  group.shift([0, top - group.top()[1]]);
  return { group, token: tok };
}

/** Inset from the bezel, and the gap between code, picture and trace. Both are under PHONE_BAND_GAP. */
const EDGE = 0.38;
const BAND = 0.42;
const TILE_W = 14.7;
const TILE_GAP = 0.22;
/** Room above the pack bar for the ref-delta arc. BAND + ARC_ROOM stays under the void check. */
const ARC_ROOM = 1.15;
const PACK_H = 2.6;

const ROW_W = 14.05;
const FORM_PAD = 0.22;
const FORM_GAP = 0.16;

interface Run { text: string; color: string }
interface CellSpec {
  fill: string;
  lines: Run[][];
  align?: 'center' | 'start';
  /** The first line is not drawn. The code token lands on that slot. */
  blank?: boolean;
  wash?: number;
}
interface Cell {
  group: Group;
  shape: Rectangle;
  texts: Text[];
  landing: { at: [number, number]; text: string; fs: number } | null;
}
interface Field { name: string; value: string; nameColor: string; valueColor: string; credential: boolean }

function glide(distance: number): number {
  return Math.min(2.05, Math.max(0.55, distance * 0.42));
}

function word(text: string, fill: string, ink: string = WHITE): CellSpec {
  return { fill, lines: [[{ text, color: ink }]] };
}

function pktRow(payload: string, color: string, hex?: string): CellSpec {
  const framed = payload ? pktLine(payload) : { hex: hex ?? '0000', body: '' };
  const runs: Run[] = framed.body
    ? [{ text: framed.hex, color: GOLD }, { text: framed.body, color }]
    : [{ text: framed.hex, color: GOLD }];
  return { fill: color === DIM ? GOLD : color, lines: [runs], align: 'start', wash: 0.16 };
}

function makeCell(spec: CellSpec, width: number, height: number, cy: number): Cell {
  const single = spec.lines.length === 1 && spec.lines[0]!.length === 1;
  const align = spec.align ?? (single ? 'center' : 'start');
  const lineWidth = (line: Run[]): number => line.reduce((s, r, i) => s + widthOf(r.text, 1) + (i ? 0.28 : 0), 0);
  const widest = Math.max(0.2, ...spec.lines.map(lineWidth));
  // Big type in a tall band. Width and the line count keep the glyphs inside the wash.
  const fs = Math.min(2.05, (height - 0.24) / (spec.lines.length * 1.38), (width - 0.7) / widest);
  const shape = new Rectangle({
    width, height, cornerRadius: Math.min(0.2, height * 0.14),
    stroke: spec.fill, strokeWidth: 0.06,
    fill: spec.fill, fillOpacity: spec.wash ?? 0.5,
  });
  shape.moveTo([0, cy]);
  const draw = spec.blank ? [] : spec.lines;
  const texts: Text[] = [];
  const lineH = fs * 1.38;
  const lead = 0.08;
  const block = Math.max(lineH, draw.length * lineH + lead * Math.max(0, draw.length - 1));
  let y = cy + block / 2 - lineH / 2;
  const left = -width / 2 + 0.42;
  for (const line of draw) {
    if (align === 'center' && line.length === 1) {
      texts.push(mono(line[0]!.text, fs, line[0]!.color).moveTo([0, y]));
    } else {
      let x = align === 'center' ? -lineWidth(line) * fs / 2 : left;
      // lineWidth is at font size 1, so scale it.
      if (align === 'center') x = -line.reduce((s, r, i) => s + widthOf(r.text, fs) + (i ? 0.28 : 0), 0) / 2;
      for (const r of line) {
        const t = mono(r.text, fs, r.color, 'start');
        t.moveTo([x, y], LEFT);
        texts.push(t);
        x += t.advance() + 0.28;
      }
    }
    y -= lineH + lead;
  }
  const first = spec.lines[0]?.[0];
  const landing = spec.blank && first ? { at: [0, cy] as [number, number], text: first.text, fs } : null;
  return { group: new Group(shape, ...texts), shape, texts, landing };
}

function stack(specs: CellSpec[], top: number, bottom: number, width = TILE_W): Cell[] {
  const n = specs.length;
  if (n < 1) throw new Error('empty picture');
  const h = (top - bottom - TILE_GAP * (n - 1)) / n;
  if (!(h > 0.9)) throw new Error(`cell height ${h.toFixed(2)} for ${n} rows in ${(top - bottom).toFixed(2)}`);
  const out: Cell[] = [];
  let y = top;
  for (const spec of specs) {
    out.push(makeCell(spec, width, h, y - h / 2));
    y -= h + TILE_GAP;
  }
  return out;
}

function reseatCellAnims(cells: Cell[], top: number, bottom: number, width: number): Transform[] {
  const n = cells.length;
  const h = (top - bottom - TILE_GAP * Math.max(0, n - 1)) / n;
  if (!(h > 0.9)) throw new Error(`reseat height ${h.toFixed(2)}`);
  const anims: Transform[] = [];
  let y = top;
  for (const cell of cells) {
    const cy = y - h / 2;
    const shape = new Rectangle({
      width, height: h, cornerRadius: Math.min(0.2, h * 0.14),
      stroke: cell.shape.style.stroke, strokeWidth: 0.06,
      fill: cell.shape.style.fill, fillOpacity: cell.shape.style.fillOpacity,
    }).moveTo([cell.shape.center()[0], cy]);
    anims.push(new Transform(cell.shape, shape));
    if (cell.texts.length) {
      const mid = cell.texts.reduce((s, t) => s + t.center()[1], 0) / cell.texts.length;
      for (const t of cell.texts) {
        const copy = t.copy();
        copy.shift([0, cy - mid]);
        anims.push(new Transform(t, copy));
      }
    }
    y -= h + TILE_GAP;
  }
  return anims;
}

/** One size for every row, so the value column and the pitch stay even as rows leave. */
function formSize(fields: Field[], rowH: number): number {
  const inner = ROW_W - 0.68;
  let fs = Math.min(1.05, rowH * 0.62);
  for (const f of fields) {
    // user-agent grows to the forced product token; budget for that before it morphs.
    const shown = f.name === 'user-agent' ? 'ply-viewer/0.1.0' : f.value;
    const budget = inner - (shown ? 0.85 : 0);
    const need = widthOf(f.name, 1) + (shown ? widthOf(shown, 1) : 0);
    fs = Math.min(fs, budget / Math.max(0.2, need));
  }
  return fs;
}

function gridRow(f: Field, rowH: number, fs: number): Group {
  const bg = new Rectangle({
    width: ROW_W, height: rowH, cornerRadius: 0.1,
    stroke: 'none', fill: f.nameColor, fillOpacity: 0.42,
  });
  const name = mono(f.name, fs, f.nameColor, 'start');
  const value = f.value ? mono(f.value, fs, f.valueColor, 'end') : null;
  bg.moveTo([0, 0]);
  name.moveTo([-ROW_W / 2 + 0.34, 0], LEFT);
  if (value) {
    value.moveTo([ROW_W / 2 - 0.34, 0], RIGHT);
    if (name.right()[0] > value.left()[0] - 0.16) throw new Error(`columns collide: ${f.name} / ${f.value}`);
  }
  return new Group(bg, name, ...(value ? [value] : []));
}

function layGrid(fields: Field[], top: number, bottom: number): { frame: Rectangle; rows: Group[] } {
  const n = fields.length;
  const rowH = (top - bottom - FORM_PAD * 2 - FORM_GAP * Math.max(0, n - 1)) / n;
  if (!(rowH > 0.7)) throw new Error(`form row ${rowH.toFixed(2)}`);
  const fs = formSize(fields, rowH);
  const frame = new Rectangle({
    width: ROW_W + FORM_PAD * 2, height: top - bottom, cornerRadius: 0.16,
    stroke: ORANGE, strokeWidth: 0.05, fill: ORANGE, fillOpacity: 0.1,
  }).moveTo([0, (top + bottom) / 2]);
  const rows: Group[] = [];
  let y = top - FORM_PAD;
  fields.forEach((f, i) => {
    const row = gridRow(f, rowH, fs);
    row.moveTo([0, y - rowH / 2]);
    rows.push(row);
    y -= rowH;
    if (i < fields.length - 1) y -= FORM_GAP;
  });
  return { frame, rows };
}

function childAnims(from: Group, to: Group): Transform[] {
  if (from.children.length !== to.children.length) throw new Error('row shape changed');
  return from.children.map((child, i) => new Transform(child, to.children[i]!));
}

export class PlyViewerScene extends Scene {
  constructor(sink: Sink, opts?: SceneOptions) {
    super(sink, opts);
    this.frame = { w: PHONE_W, h: PHONE_H };
  }

  override async construct(): Promise<void> {
    if (BAND + ARC_ROOM > PHONE_BAND_GAP) throw new Error('pack gap exceeds the void check');
    const cam = this.frame;
    const TOP = cam.h / 2;
    const BOT = -TOP;
    const st = {
      repo: 'ivarvong/ply-web',
      url: 'octocat/Hello-World',
      host: '',
      filter: '',
      http: 0,
      dropped: '',
      pkt: '',
      pack: '',
      delta: '',
      clockMs: 0,
    };
    this.state = st;

    const graphic = new Group();
    const data = new Group();
    this.add(graphic, data);
    let code: Group | null = null;
    let citeT: Text | null = null;
    const links: Group[] = [];

    const clearLinks = async (): Promise<void> => {
      if (!links.length) return;
      const gone = links.splice(0);
      await this.play(...gone.map((l) => new FadeOut(l)), { runTime: 0.25 });
    };
    // A short orthogonal stub across the gap between two bands. It leaves the
    // near edge of the source (the whole code block, when the source is a token
    // inside it) and meets the facing edge of the target. No gutter loop.
    const link = async (from: Mobject, to: Mobject, color: string, at?: number): Promise<void> => {
      const host = code && code.family().includes(from) ? code : from;
      const a = host.box();
      const b = to.box();
      const mark = from.box();
      if (!a || !b || !mark) throw new Error('connector is missing a box');
      const ax = at ?? (mark[0] + mark[2]) / 2;
      const down = (b[1] + b[3]) / 2 <= (a[1] + a[3]) / 2;
      const x = Math.min(b[2] - 0.2, Math.max(b[0] + 0.2, ax));
      const yEdge = down ? a[1] - 0.12 : a[3] + 0.12;
      const yFace = down ? b[3] + 0.1 : b[1] - 0.1;
      const x0 = Math.min(a[2] - 0.15, Math.max(a[0] + 0.15, ax));
      const pts: Array<[number, number]> = [[x0, yEdge]];
      if (Math.abs(x - x0) > 0.04) pts.push([x, yEdge]);
      pts.push([x, yFace]);
      const lines: Line[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i]!, q = pts[i + 1]!;
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.02) continue;
        lines.push(new Line(p, q, { stroke: color, strokeWidth: 0.05 }));
      }
      if (!lines.length) return;
      const path = new Group(...lines);
      links.push(path);
      await this.play(new Create(path, { lagRatio: 0 }), { runTime: 0.35 });
    };
    const swapCode = async (
      file: string, line: number, source: string, token: string, color: string,
      alongside?: () => Transform[],
    ): Promise<Text> => {
      await clearLinks();
      const nextCite = mono(`${file}:${line}`, 0.5, DIM, 'start');
      nextCite.moveTo([INK_LEFT, TOP - EDGE], UL);
      const next = buildLine(source, token, color, nextCite.bottom()[1] - 0.28);
      const out: FadeOut[] = [];
      if (code) out.push(new FadeOut(code));
      if (citeT) out.push(new FadeOut(citeT));
      if (out.length) await this.play(...out, { runTime: 0.25 });
      code = next.group;
      citeT = nextCite;
      const extra = alongside?.() ?? [];
      await this.play(new FadeIn(code), new FadeIn(citeT), ...extra, { runTime: 0.4 });
      return next.token;
    };
    const clearGraphic = async (): Promise<void> => {
      await clearLinks();
      if (!graphic.children.length) return;
      await this.play(new FadeOut(graphic), { runTime: 0.28 });
      graphic.remove(...graphic.children.slice());
      this.add(graphic);
    };
    const depart = async (token: Text, to: Readonly<[number, number]>, opts: { text?: string; color?: string; scale?: number } = {}): Promise<{ flown: Text; home: Text }> => {
      const parent = token.parent;
      const home = token.copy();
      const target = token.copy();
      if (opts.text) target.setText(opts.text);
      if (opts.color) target.setFill(opts.color);
      if (opts.scale && opts.scale !== 1) target.scale(opts.scale);
      target.moveTo(to);
      const d = Math.hypot(to[0] - token.center()[0], to[1] - token.center()[1]);
      await this.play(new Transform(token, target), { runTime: glide(d) });
      graphic.add(token);
      if (parent) {
        await this.play(new FadeIn(home), { runTime: 0.25 });
        this.remove(home);
        parent.add(home);
      }
      return { flown: token, home };
    };
    const pictureTop = (): number => {
      if (!code) throw new Error('picture before code');
      return code.bottom()[1] - BAND;
    };
    const reveal = async (cells: Cell[], extra: Mobject[] = []): Promise<void> => {
      const groups = cells.map((c) => c.group);
      graphic.add(...extra, ...groups);
      await this.play(
        ...extra.map((m) => new FadeIn(m, { runTime: 0.3 })),
        new LaggedStart(groups.map((g) => new FadeIn(g, { runTime: 0.28 })), { lagRatio: 0.07 }),
        { runTime: 0.7 },
      );
    };
    const land = async (token: Text, cell: Cell, color: string): Promise<{ flown: Text; home: Text }> => {
      const slot = cell.landing;
      if (!slot) throw new Error('nothing to land on');
      const done = await depart(token, slot.at, { text: slot.text, color, scale: slot.fs / FS });
      // The word belongs to the band it landed on, so a later reseat carries it.
      cell.group.add(done.flown);
      cell.texts.push(done.flown);
      return done;
    };

    const STATE_FS = 0.92;
    const pinState = (text: string, color: string): Text => {
      const t = mono(text, STATE_FS, color);
      t.moveTo([0, BOT + EDGE + t.height() / 2]);
      return t;
    };

    // Trace bars stack upward. One caption each, on the bar. The newest bar is the one the picture meets.
    const bx0 = -TILE_W / 2;
    const bScale = (TILE_W - 0.5) / 505;
    const barH = 1.25;
    const capGap = 0.12;
    const CAP = fitSize('400 filter not allowed · 443 ms', TILE_W - 0.4, 0.8);
    const capH = mono('400 filter not allowed · 443 ms', CAP, RED).height();
    const barPitch = barH + capGap + capH + 0.28;
    const barCenter = (index: number): number => BOT + EDGE + capH + capGap + barH / 2 + index * barPitch;
    const aboveTrace = (n: number): number => barCenter(n - 1) + barH / 2 + BAND;
    /** Where the picture ends before the next bar exists: on the bezel, or just above the bars already drawn. */
    const traceFloor = (): number => barGroups.length === 0 ? BOT + EDGE : aboveTrace(barGroups.length);
    const barGroups: Group[] = [];
    const growBar = async (
      ms: number, start: number, color: string, name: string, lift?: Cell[],
    ): Promise<{ group: Group; bar: Rectangle; caption: Text }> => {
      const y = barCenter(barGroups.length);
      const w = Math.max(0.4, ms * bScale);
      const full = new Rectangle({ width: w, height: barH, fill: color, fillOpacity: 0.94, stroke: 'none' });
      full.moveTo([bx0, y], LEFT);
      const bar = full.copy();
      bar.stretch(0.08 / w, 0, { aboutEdge: LEFT });
      const g = new Group(bar);
      data.add(g);
      barGroups.push(g);
      // Open the slot and show the bar in one gesture, so the band never rests empty.
      const liftAnims = lift?.length ? reseatCellAnims(lift, pictureTop(), y + barH / 2 + BAND, TILE_W) : [];
      await this.play(new FadeIn(bar), ...liftAnims, { runTime: 0.4 });
      await this.play(new Transform(bar, full), { runTime: 0.65, rateFunc: linear });
      const caption = mono(name, CAP, color, 'start');
      caption.moveTo([bx0, y - barH / 2 - capGap - caption.height() / 2], LEFT);
      g.add(caption);
      await this.play(new FadeIn(caption), { runTime: 0.22 });
      st.clockMs = start + ms;
      return { group: g, bar, caption };
    };

    // ---- url -----------------------------------------------------------------
    await this.step('url', { caption: 'owner/repo means GitHub. The paste becomes the path.', file: 'worker/viewer/paste.ts', line: 34 });
    const urlTok = await swapCode(
      'worker/viewer/paste.ts', 34,
      '  if (OWNER_REPO.test(text)) return { remote: `https://github.com/${text}` };',
      'github.com', TEAL,
    );
    const remote = pinState('remote  github.com', TEAL);
    const urlCells = stack([
      { ...word('github.com', TEAL), blank: true },
      word('/view/', GOLD),
      word('octocat', INK),
      word('Hello-World', INK),
    ], pictureTop(), remote.top()[1] + BAND);
    await reveal(urlCells, [remote]);
    const { home: urlHome } = await land(urlTok, urlCells[0]!, WHITE);
    st.url = '/view/github.com/octocat/Hello-World';
    await link(urlHome, urlCells[0]!.shape, TEAL);
    await this.wait(0.35);

    // ---- allow ---------------------------------------------------------------
    await this.step('allow', { caption: 'Exact match only. A trailing dot is a different host.', file: 'worker/viewer/url.ts', line: 79 });
    graphic.remove(remote);
    this.add(remote);
    await clearGraphic();
    const allowTok = await swapCode(
      'worker/viewer/url.ts', 79,
      '  for (const item of allowed) if (item === host) return true;',
      'item === host', TEAL,
    );
    const hostNames = ['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org', 'git.sr.ht', 'github.com.'] as const;
    let hosts = stack(hostNames.map((n, i) => word(n, i === 0 ? TEAL : i === hostNames.length - 1 ? RED : DIM, i === hostNames.length - 1 ? RED : WHITE)), pictureTop(), remote.top()[1] + BAND);
    await reveal(hosts);
    const gh = hosts[0]!;
    gh.shape.setStyle({ stroke: TEAL, fill: TEAL, fillOpacity: 0.72 });
    st.host = 'github.com';
    const kept = hosts.slice(0, 5);
    const bad = hosts[5]!;
    await this.play(
      new FadeOut(bad.group),
      ...reseatCellAnims(kept, pictureTop(), remote.top()[1] + BAND, TILE_W),
      { runTime: 0.5 },
    );
    hosts = kept;
    await link(allowTok, gh.shape, TEAL);
    const hostLine = pinState('host  github.com', TEAL);
    await this.play(new Transform(remote, hostLine), { runTime: 0.4 });
    this.remove(remote);
    graphic.add(remote);
    await this.wait(0.35);

    // ---- strip ---------------------------------------------------------------
    await this.step('strip', { caption: 'Credentials leave the request. User-Agent is forced.', file: 'worker/viewer/fetchguard.ts', line: 18 });
    await clearGraphic();
    await swapCode(
      'worker/viewer/fetchguard.ts', 18,
      '    if (ALLOWED.has(key.toLowerCase())) out.set(key, value);',
      'ALLOWED.has', ORANGE,
    );
    const fields: Field[] = [
      { name: 'Authorization', value: '<client>', nameColor: ORANGE, valueColor: ORANGE, credential: true },
      { name: 'Cookie', value: '<client>', nameColor: ORANGE, valueColor: ORANGE, credential: true },
      { name: 'Git-Token', value: '<client>', nameColor: ORANGE, valueColor: ORANGE, credential: true },
      { name: 'Git-Authorization', value: '<client>', nameColor: ORANGE, valueColor: ORANGE, credential: true },
      { name: 'accept', value: '*/*', nameColor: TEAL, valueColor: INK, credential: false },
      { name: 'git-protocol', value: 'version=2', nameColor: TEAL, valueColor: INK, credential: false },
      { name: 'user-agent', value: '<client>', nameColor: INK, valueColor: DIM, credential: false },
    ];
    const bandTop = pictureTop();
    const bandBot = BOT + EDGE;
    let grid = layGrid(fields, bandTop, bandBot);
    let live = fields.slice();
    const sheet = new Group(grid.frame, ...grid.rows);
    graphic.add(sheet);
    await this.play(new LaggedStart([grid.frame, ...grid.rows].map((m) => new FadeIn(m, { runTime: 0.26 })), { lagRatio: 0.07 }), { runTime: 0.75 });
    await link(code!.children.flatMap((r) => r.children).find((m) => m instanceof Text && m.text === 'ALLOWED.has') as Text, grid.frame, ORANGE);
    await clearLinks();
    const dropped: string[] = [];
    for (const spec of fields.filter((f) => f.credential)) {
      const idx = live.indexOf(spec);
      const row = grid.rows[idx]!;
      const stayRows = grid.rows.filter((_, i) => i !== idx);
      const stay = live.filter((f) => f !== spec);
      const next = layGrid(stay, bandTop, bandBot);
      await this.play(
        new FadeOut(row),
        new Transform(grid.frame, next.frame),
        ...stayRows.flatMap((r, i) => childAnims(r, next.rows[i]!)),
        { runTime: 0.5 },
      );
      grid.rows = stayRows;
      live = stay;
      dropped.push(spec.name);
      st.dropped = dropped.join(' ');
    }
    const n1 = live.length;
    const n2 = dropped.length + 1;
    const between = 0.32;
    const rowH = (bandTop - bandBot - between - FORM_PAD * 4 - FORM_GAP * (n1 + n2 - 2)) / (n1 + n2);
    const headerH = FORM_PAD * 2 + n1 * rowH + FORM_GAP * (n1 - 1);
    const header = layGrid(live, bandTop, bandTop - headerH);
    const stripTop = bandTop - headerH - between;
    const lowerH = FORM_PAD * 2 + n2 * rowH + FORM_GAP * (n2 - 1);
    const stripped = layGrid(
      [{ name: 'stripped', value: '', nameColor: DIM, valueColor: DIM, credential: false },
        ...dropped.map((name) => ({ name, value: '', nameColor: ORANGE, valueColor: ORANGE, credential: false }))],
      stripTop, stripTop - lowerH,
    );
    const strippedGroup = new Group(stripped.frame, ...stripped.rows);
    sheet.add(strippedGroup);
    await this.play(
      new Transform(grid.frame, header.frame),
      ...grid.rows.flatMap((r, i) => childAnims(r, header.rows[i]!)),
      new FadeIn(strippedGroup),
      { runTime: 0.55 },
    );
    const uaTok = await swapCode(
      'worker/viewer/fetchguard.ts', 20,
      "  out.set('user-agent', VIEWER_UA);",
      'VIEWER_UA', GOLD,
      () => {
        const dy = (code!.bottom()[1] - BAND) - sheet.top()[1];
        if (Math.abs(dy) < 0.05) return [];
        const moved = sheet.copy();
        moved.shift([0, dy]);
        return [new Transform(sheet, moved)];
      },
    );
    const uaRow = grid.rows[live.length - 1]!;
    const uaValue = uaRow.children[2];
    if (!(uaValue instanceof Text)) throw new Error('user-agent value');
    const uaNext = uaValue.copy();
    uaNext.setText('ply-viewer/0.1.0');
    uaNext.setFill(GOLD);
    uaNext.moveTo([ROW_W / 2 - 0.34, uaValue.center()[1]], RIGHT);
    await this.play(new Transform(uaValue, uaNext), { runTime: 0.4 });
    await link(uaTok, grid.frame, GOLD);
    await this.wait(0.35);

    // ---- refs ----------------------------------------------------------------
    await this.step('refs', { caption: 'listRefs asks for HEAD and refs/heads/.', file: 'worker/viewer/session.ts', line: 185 });
    await clearGraphic();
    const refTok = await swapCode(
      'worker/viewer/session.ts', 185,
      '  const listedRefs = await listRefs(transport, refPrefixes(route.ref));',
      'refPrefixes', TEAL,
    );
    const refCells = stack([
      pktRow('command=ls-refs\n', INK),
      pktRow('', GOLD, '0001'),
      pktRow('peel\n', DIM),
      pktRow('symrefs\n', DIM),
      pktRow('ref-prefix HEAD\n', TEAL),
      pktRow('ref-prefix refs/heads/\n', TEAL),
      pktRow('', GOLD, '0000'),
    ], pictureTop(), traceFloor());
    await reveal(refCells);
    st.pkt = '0014command=ls-refs 0001 0009peel 000csymrefs 0014ref-prefix HEAD 001bref-prefix refs/heads/ 0000';
    const refsBar = await growBar(438, 0, TEAL, 'ls-refs · 438 ms', refCells);
    await link(refTok, refCells[0]!.shape, TEAL);
    await link(refCells[refCells.length - 1]!.shape, refsBar.bar, TEAL);
    await this.wait(0.35);

    // ---- fetch ---------------------------------------------------------------
    await this.step('fetch', { caption: 'The commit fetch asks for filter tree:0.', file: 'worker/viewer/session.ts', line: 187 });
    await clearGraphic();
    const fetchTok = await swapCode(
      'worker/viewer/session.ts', 187,
      "  const commitObj = await readObject(transport, { oid: resolved.commit, filter: 'tree:0', deepen: 1, expectType: TYPE.COMMIT });",
      "filter: 'tree:0'", GREEN,
    );
    const fetchCells = stack([
      { ...word(`${pktLine('filter tree:0\n').hex} filter tree:0`, GREEN), blank: true },
      word('deepen 1', GREEN),
      word('expectType', INK),
      word('TYPE.COMMIT', BLUE),
      word('resolved.commit', BLUE),
    ], pictureTop(), traceFloor());
    await reveal(fetchCells);
    const { home: treeHome } = await land(fetchTok, fetchCells[0]!, WHITE);
    const treeBar = await growBar(443, 438, GREEN, 'tree:0 · 443 ms', fetchCells);
    const redBar = treeBar.bar.copy();
    redBar.setFill(RED);
    const denied = mono('400 filter not allowed · 443 ms', CAP, RED, 'start');
    denied.moveTo(treeBar.caption, LEFT);
    await this.play(new Transform(treeBar.bar, redBar), new Transform(treeBar.caption, denied), { runTime: 0.5 });
    st.filter = 'tree:0';
    st.http = 400;
    await link(treeHome, fetchCells[0]!.shape, GREEN);
    await link(fetchCells[fetchCells.length - 1]!.shape, treeBar.bar, RED);
    await this.wait(0.35);

    // ---- retry ---------------------------------------------------------------
    await this.step('retry', { caption: 'That answer is the rejection. The retry is blob:none.', file: 'src/fetch.js', line: 176 });
    await clearGraphic();
    const retryTok = await swapCode(
      'src/fetch.js', 176,
      "    if (t.quirks) t.quirks.treeFilter = 'blob:none';",
      'blob:none', TEAL,
    );
    const retryCells = stack([
      { ...word(`${pktLine('filter blob:none\n').hex} filter blob:none`, TEAL), blank: true },
      word('quirks.treeFilter', TEAL),
      word('blob:none', TEAL),
      word('t.quirks', INK),
    ], pictureTop(), traceFloor());
    await reveal(retryCells);
    const { home: blobHome } = await land(retryTok, retryCells[0]!, WHITE);
    const blobBar = await growBar(505, 881, TEAL, '200 · blob:none · 505 ms', retryCells);
    st.filter = 'blob:none';
    st.http = 200;
    await link(blobHome, retryCells[0]!.shape, TEAL);
    await link(retryCells[retryCells.length - 1]!.shape, blobBar.bar, TEAL);
    await this.wait(0.35);

    // ---- pack ----------------------------------------------------------------
    await this.step('pack', { caption: 'parsePack records each object offset as the bytes arrive.', file: 'src/packresolve.js', line: 38 });
    await clearGraphic();
    const offTok = await swapCode(
      'src/packresolve.js', 38,
      '    const offset = p;',
      'offset', BLUE,
    );
    const packTop = pictureTop() - ARC_ROOM;
    const packY = packTop - PACK_H / 2;
    const x0 = -TILE_W / 2;
    const segs: Rectangle[] = [];
    for (const [off, len, fill] of PACK) {
      const w = Math.max(0.08, (len / PACK_BYTES) * TILE_W);
      const rect = new Rectangle({ width: w, height: PACK_H, fill, fillOpacity: 0.94, stroke: 'none' });
      rect.moveTo([x0 + (off / PACK_BYTES) * TILE_W, packY], LEFT);
      segs.push(rect);
    }
    const packBar = new Group(...segs);
    const legendBottom = aboveTrace(barGroups.length);
    const legend = stack([
      { ...word('930 B · 9 objects', DIM, DIM), wash: 0.2 },
      { ...word('@12 · 371 B · commit', BLUE, WHITE), wash: 0.45 },
      { ...word('@383 · 183 B · ref-delta', RED, WHITE), wash: 0.45 },
      { ...word('@566 · 108 B · tree', GREEN, WHITE), wash: 0.45 },
    ], packTop - PACK_H - TILE_GAP, legendBottom);
    await reveal(legend, [packBar]);
    const pack = {
      bar: packBar, legend, arc: null as CurvedArrow | null,
      barTop: packTop, legendBottom, segs,
    };
    st.pack = '930 B @12 371 @383 183 @566 108';
    // Left rim of the commit slice. The ref-delta arc lands on the right rim, so the two never share a column.
    await link(offTok, segs[1]!, BLUE, segs[1]!.left()[0] + 0.35);
    const reseatPack = (): Transform[] => {
      const newBarTop = code!.bottom()[1] - BAND - ARC_ROOM;
      const D = pack.barTop - newBarTop;
      if (Math.abs(D) < 0.04) return [];
      const anims: Transform[] = [];
      const moved = pack.bar.copy();
      moved.shift([0, -D]);
      anims.push(new Transform(pack.bar, moved));
      if (pack.arc) {
        const arcNext = pack.arc.copy();
        arcNext.shift([0, -D]);
        anims.push(new Transform(pack.arc, arcNext));
      }
      anims.push(...reseatCellAnims(pack.legend, newBarTop - PACK_H - TILE_GAP, pack.legendBottom, TILE_W));
      pack.barTop = newBarTop;
      return anims;
    };
    await this.wait(0.35);

    // ---- delta ---------------------------------------------------------------
    await this.step('delta', { caption: 'The ref-delta names its base. applyDelta makes a commit.', file: 'src/packresolve.js', line: 51 });
    const baseTok = await swapCode(
      'src/packresolve.js', 51,
      '      baseOid = toHex(buf.subarray(p, p + 20)); p += 20;',
      'baseOid', RED,
      reseatPack,
    );
    const baseTop = segs[2]!.top();
    const commitTop = segs[1]!.top();
    const arc = new CurvedArrow(
      [segs[2]!.center()[0], baseTop[1] + 0.18],
      [segs[1]!.center()[0], commitTop[1] + 0.18],
      { angle: Math.PI / 7, stroke: RED, strokeWidth: 0.05, tipLength: 0.2, tipWidth: 0.14 },
    );
    pack.arc = arc;
    graphic.add(arc);
    await this.play(new Create(arc), { runTime: 0.7 });
    await link(baseTok, segs[2]!, RED, segs[2]!.right()[0] - 0.35);
    const applyTok = await swapCode(
      'src/packresolve.js', 154,
      '      const { out, ops } = applyDelta(base.data, obj.data, { maxResult: limits.maxDeltaResult });',
      'applyDelta', BLUE,
      reseatPack,
    );
    const refLabel = legend[2]!.texts[0]!;
    const resolved = refLabel.copy();
    resolved.setText('@383 · 183 B · commit');
    resolved.setFill(WHITE);
    resolved.moveTo(refLabel.center());
    await this.play(
      segs[2]!.animate.setFill(BLUE),
      legend[2]!.shape.animate.setFill(BLUE).setStroke(BLUE),
      new Transform(refLabel, resolved),
      { runTime: 0.55 },
    );
    st.delta = '@383 -> @12 chain 1';
    await link(applyTok, segs[2]!, BLUE, segs[2]!.right()[0] - 0.35);
    await this.wait(0.35);

    // ---- trace ---------------------------------------------------------------
    await this.step('trace', { caption: 'The measured calls, after discover. 438, then 443, then 505.', file: 'src/otel.js', line: 48 });
    await clearGraphic();
    const spanTok = await swapCode(
      'src/otel.js', 48,
      '  async span(name, opts, fn) {',
      'span', GOLD,
    );
    const traceCells = stack([
      word('3 upstream calls', GOLD),
      word('ls-refs · 438 ms', TEAL),
      word('tree:0 · 443 ms', RED),
      word('blob:none · 505 ms', TEAL),
      word('1 retry · 1.4 s', GOLD),
    ], pictureTop(), aboveTrace(barGroups.length));
    await reveal(traceCells);
    await link(spanTok, traceCells[0]!.shape, GOLD);
    await link(traceCells[traceCells.length - 1]!.shape, blobBar.bar, TEAL);
    await this.wait(0.35);

    // ---- pipeline ------------------------------------------------------------
    await this.step('pipeline', { caption: 'Fresh quirks, so this request still shows the retry.', file: 'worker/viewer/session.ts', line: 302 });
    await clearGraphic();
    const endTok = await swapCode(
      'worker/viewer/session.ts', 302,
      '  const quirks: Quirks = {};',
      'quirks', WHITE,
    );
    const stageCells = stack([
      word('github.com', TEAL),
      word('strip', ORANGE),
      word('ls-refs', TEAL),
      word('400', RED),
      word('200', TEAL),
      word('@12', BLUE),
      word('1.4 s', GOLD),
    ], pictureTop(), aboveTrace(barGroups.length));
    await reveal(stageCells);
    await link(endTok, stageCells[0]!.shape, WHITE);
    await link(stageCells[stageCells.length - 1]!.shape, blobBar.bar, GOLD);
    await this.wait(0.35);
  }
}
