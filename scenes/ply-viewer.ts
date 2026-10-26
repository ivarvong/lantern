// ply /view, on a phone canvas.
//
// The public viewer is moving from ivarvong/ply to ivarvong/ply-web. ply-web has
// no commits yet, so every quoted line is from ivarvong/ply pull/2 at
// 3f07a75c667ab8afad9e91d396836eb21abb1b8f. The page stays
// ply.ivar.workers.dev/view.
//
// The camera is the 390×844 phone. Code sits at the top, the picture is a
// content-sized group centered in the space that remains, and the trace is
// pinned to the bottom. Empty margin around that group is part of the
// composition. Boxes hug their text; a bar is wide only when its width is
// bytes or time.
//
// Colors are the concept, on every pane:
//   host / ls-refs / blob:none retry = teal,  tree / tree:0 = green,
//   commit / offset = blue,  ref-delta = red,  credential = orange,
//   blob bytes = grey,  pkt length / span = gold,  HTTP 400 = red.
import {
  Scene, Group, Text, Rectangle, Line, CurvedArrow, FadeIn, FadeOut, Create, Transform, LaggedStart,
  LEFT, RIGHT, DOWN, UL,
  PHONE_TYPE_CODE, PHONE_TYPE_LABEL, PHONE_PAD, PHONE_CONNECTOR_MAX,
  BLUE, TEAL, GREEN, RED, GREY, WHITE, ORANGE, GOLD,
} from '../src/index.ts';
import type { Sink, SceneOptions, Mobject } from '../src/index.ts';
import { PACK_BYTES, PACK_COMMIT_OID, PACK_HEADER, PACK_OBJECTS, PACK_TRAILER, wireName } from './lib/small-pack.ts';
import type { PackWire, PackWireObject } from './lib/small-pack.ts';

const INK = '#d8d8d8';
const DIM = '#8d8d8d';
const PHONE_W = 16;
const PHONE_H = PHONE_W * (844 / 390);
const FS = PHONE_TYPE_CODE;
const LABEL = PHONE_TYPE_LABEL;
const PAD = PHONE_PAD;
const MAX_W = 14.6;
const INK_LEFT = -7.3;
const ELL = '...';
const CHIP_GAP = 0.16;

function packObject(kind: PackWireObject['kind']): PackWireObject {
  const found = PACK_OBJECTS.find((o) => o.kind === kind);
  if (!found) throw new Error(`fixture pack is missing a ${kind}`);
  return found;
}
const commitObj = packObject('commit');
const refDelta = packObject('ref_delta');
const treeObj = packObject('tree');

function kindColor(kind: PackWire): string {
  if (kind === 'commit') return BLUE;
  if (kind === 'tree') return GREEN;
  if (kind === 'ref_delta' || kind === 'ofs_delta') return RED;
  return GREY;
}

function legendText(obj: PackWireObject): string {
  return `@${obj.offset} · ${obj.length} B · ${wireName(obj.kind)}`;
}

/**
 * pkt() in src/pktline.js: 4 hex digits plus the payload bytes. Callers pass
 * the trailing newline inside the payload, and the length counts it.
 * The newline is not drawn.
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

interface Run { text: string; color: string }

/** A box the size of its text, plus PHONE_PAD on every side. */
function chip(lines: Run[][], stroke: string): Group {
  const textH = mono('Mg', LABEL, INK).height();
  const lead = 0.08;
  const rendered: Text[][] = [];
  let blockW = 0;
  for (const line of lines) {
    const row: Text[] = [];
    let x = 0;
    for (let i = 0; i < line.length; i++) {
      const run = line[i]!;
      const t = mono(run.text, LABEL, run.color, 'start');
      row.push(t);
      x += t.advance() + (i < line.length - 1 ? 0.22 : 0);
    }
    blockW = Math.max(blockW, x);
    rendered.push(row);
  }
  const blockH = rendered.length * textH + Math.max(0, rendered.length - 1) * lead;
  const shape = new Rectangle({
    width: blockW + 2 * PAD, height: blockH + 2 * PAD, cornerRadius: 0.12,
    stroke, strokeWidth: 0.04, fill: stroke, fillOpacity: 0.16,
  });
  let y = blockH / 2 - textH / 2;
  for (const row of rendered) {
    let x = -blockW / 2;
    for (let i = 0; i < row.length; i++) {
      const t = row[i]!;
      t.moveTo([x, y], LEFT);
      x += t.advance() + 0.22;
    }
    y -= textH + lead;
  }
  return new Group(shape, ...rendered.flat());
}

function pile(chips: Group[], align: 'center' | 'left' = 'center'): Group {
  const g = new Group(...chips);
  if (chips.length > 1) g.arrange(DOWN, CHIP_GAP, align === 'left' ? LEFT : [0, 0]);
  return g;
}

function pktChip(payload: string, color: string, hex?: string): Group {
  const framed = payload ? pktLine(payload) : { hex: hex ?? '0000', body: '' };
  const line: Run[] = framed.body
    ? [{ text: framed.hex, color: GOLD }, { text: framed.body, color }]
    : [{ text: framed.hex, color: GOLD }];
  return chip([line], color);
}

/** The commit fetch body from fetchBody(), delim after command=fetch, flush at the end. */
function fetchColumn(filter: string): { group: Group; filter: Group } {
  const framed = pktLine(`filter ${filter}\n`);
  const filterChip = chip([[{ text: framed.hex, color: GOLD }, { text: framed.body, color: filter === 'tree:0' ? GREEN : TEAL }]], filter === 'tree:0' ? GREEN : TEAL);
  const oid = PACK_COMMIT_OID;
  const want = chip([
    [{ text: pktLine(`want ${oid}\n`).hex, color: GOLD }, { text: 'want', color: INK }],
    [{ text: oid.slice(0, 20), color: INK }],
    [{ text: oid.slice(20), color: INK }],
  ], DIM);
  // fetchBody() order: command, delim, want, filter, deepen, ofs-delta, no-progress, done, flush.
  const group = pile([
    pktChip('command=fetch\n', INK),
    pktChip('', GOLD, '0001'),
    want,
    filterChip,
    pktChip('deepen 1\n', DIM),
    pktChip('ofs-delta\n', DIM),
    pktChip('no-progress\n', DIM),
    pktChip('done\n', DIM),
    pktChip('', GOLD, '0000'),
  ], 'left');
  return { group, filter: filterChip };
}

interface Field { name: string; value: string; nameColor: string; valueColor: string; credential: boolean }
interface Row { group: Group; shape: Rectangle; name: Text; value: Text | null }

function layForm(fields: Field[]): { frame: Rectangle; rows: Row[]; group: Group } {
  const gutter = 0.5;
  const shown = (f: Field): string => f.name === 'user-agent' ? 'ply-viewer/0.1.0' : f.value;
  let inner = 0;
  for (const f of fields) {
    const v = shown(f);
    inner = Math.max(inner, widthOf(f.name, LABEL) + (v ? gutter + widthOf(v, LABEL) : 0));
  }
  const textH = mono('Mg', LABEL, INK).height();
  const rowH = textH + 2 * PAD;
  const W = inner + 2 * PAD;
  const rows: Row[] = fields.map((f) => {
    const shape = new Rectangle({
      width: W, height: rowH, cornerRadius: 0.1,
      stroke: f.nameColor, strokeWidth: 0.04,
      fill: f.nameColor, fillOpacity: 0.14,
    });
    const name = mono(f.name, LABEL, f.nameColor, 'start');
    const value = f.value ? mono(f.value, LABEL, f.valueColor, 'end') : null;
    name.moveTo([-W / 2 + PAD, 0], LEFT);
    if (value) {
      value.moveTo([W / 2 - PAD, 0], RIGHT);
      if (name.right()[0] > value.left()[0] - 0.2) throw new Error(`columns collide: ${f.name} / ${f.value}`);
    }
    return { group: new Group(shape, name, ...(value ? [value] : [])), shape, name, value };
  });
  const stack = new Group(...rows.map((r) => r.group));
  if (rows.length > 1) stack.arrange(DOWN, 0.14);
  const frame = new Rectangle({
    width: stack.width() + 0.18, height: stack.height() + 0.18, cornerRadius: 0.14,
    stroke: ORANGE, strokeWidth: 0.045, strokeOpacity: 0.5,
    fill: ORANGE, fillOpacity: 0.05,
  });
  frame.moveTo(stack);
  return { frame, rows, group: new Group(frame, stack) };
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
    graphic.layoutGroup = 'picture';
    const data = new Group();
    data.layoutGroup = 'trace';
    const wires = new Group();
    this.add(graphic, data, wires);

    let code: Group | null = null;
    let picture: Group | null = null;

    const traceCeiling = (): number => {
      const b = data.children.length ? data.box() : null;
      return b ? b[3] + 0.22 : BOT + 0.28;
    };
    const seatDy = (g: Group): number => {
      if (!code) throw new Error('picture before code');
      const hi = code.bottom()[1] - 0.2;
      const lo = traceCeiling();
      let dy = (hi + lo) / 2 - g.center()[1];
      if (g.top()[1] + dy > hi) dy = hi - g.top()[1];
      if (g.bottom()[1] + dy < lo) dy = lo - g.bottom()[1];
      if (g.top()[1] + dy > hi + 0.04) throw new Error(`picture does not fit under the code (${g.height().toFixed(2)} tall)`);
      return dy;
    };
    const place = (g: Group): void => { g.shift([0, seatDy(g)]); };
    // x-ranges of `datum` a vertical drop can reach without crossing a sibling above it.
    const clearSpans = (g: Group, datum: Mobject): Array<[number, number]> => {
      const db = datum.box();
      if (!db) return [];
      const own = new Set(datum.family());
      const above: Array<[number, number]> = [];
      for (const m of g.family()) {
        if (!(m instanceof Rectangle) || own.has(m)) continue;
        if ((m.style.opacity ?? 1) < 0.5) continue;
        const b = m.box();
        if (!b || b[1] < db[3] - 0.05) continue;
        above.push([b[0], b[2]]);
      }
      const margin = 0.16;
      let spans: Array<[number, number]> = [[db[0] + margin, db[2] - margin]];
      for (const [x0, x1] of above) {
        const next: Array<[number, number]> = [];
        for (const [lo, hi] of spans) {
          if (x1 <= lo || x0 >= hi) { next.push([lo, hi]); continue; }
          if (x0 - 0.06 > lo) next.push([lo, x0 - 0.06]);
          if (x1 + 0.06 < hi) next.push([x1 + 0.06, hi]);
        }
        spans = next.filter(([lo, hi]) => hi - lo > 0.15);
      }
      return spans;
    };
    const alignTo = (g: Group, datum: Mobject, token: Text): void => {
      const tb = token.box();
      const db = datum.box();
      const gb = g.box();
      if (!tb || !db || !gb) return;
      const xTok = (tb[0] + tb[2]) / 2;
      const limit = 7.65;
      let best: number | null = null;
      for (const [lo, hi] of clearSpans(g, datum)) {
        const dxLo = Math.max(xTok - hi, -limit - gb[0]);
        const dxHi = Math.min(xTok - lo, limit - gb[2]);
        if (dxLo > dxHi) continue;
        const dx = dxLo > 0 ? dxLo : dxHi < 0 ? dxHi : 0;
        if (best == null || Math.abs(dx) < Math.abs(best)) best = dx;
      }
      if (best != null) { g.shift([best, 0]); return; }
      g.shift([xTok - (db[0] + db[2]) / 2, 0]);
      const b = g.box();
      if (!b) return;
      if (b[0] < -limit) g.shift([-limit - b[0], 0]);
      if (b[2] > limit) g.shift([limit - b[2], 0]);
    };

    const clearLinks = async (): Promise<void> => {
      if (!wires.children.length) return;
      const gone = wires.children.slice();
      await this.play(...gone.map((l) => new FadeOut(l)), { runTime: 0.2 });
      wires.remove(...gone);
    };
    const hits = (x: number, y0: number, y1: number, target: Mobject): boolean => {
      const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
      const own = new Set(target.family());
      for (const m of graphic.family()) {
        if (!(m instanceof Rectangle) || own.has(m)) continue;
        if ((m.style.opacity ?? 1) < 0.5) continue;
        const b = m.box();
        if (!b) continue;
        if (x <= b[0] + 0.05 || x >= b[2] - 0.05) continue;
        if (Math.min(b[3], hi) - Math.max(b[1], lo) > 0.05) return true;
      }
      return false;
    };
    const link = async (token: Text, target: Mobject, color: string, at?: number): Promise<void> => {
      const mark = token.box();
      const host = code?.box() ?? null;
      const tb = target.box();
      const pb = graphic.box();
      if (!mark || !host || !tb || !pb) throw new Error('connector is missing a box');
      const xTok = Math.min(host[2] - 0.15, Math.max(host[0] + 0.15, (mark[0] + mark[2]) / 2));
      const gapTop = host[1];
      const gapBot = pb[3];
      const yRail = gapBot < gapTop - 0.12 ? (gapTop + gapBot) / 2 : gapTop - 0.16;
      const xMid = Math.min(tb[2] - 0.22, Math.max(tb[0] + 0.22, at ?? (tb[0] + tb[2]) / 2));
      const xDrop = at == null && xTok > tb[0] + 0.2 && xTok < tb[2] - 0.2 ? xTok : xMid;
      const yTop = tb[3] + 0.06;
      const pts: Array<[number, number]> = [];
      if (!hits(xDrop, yRail, yTop, target)) {
        pts.push([xTok, yRail]);
        if (Math.abs(xDrop - xTok) > 0.08) pts.push([xDrop, yRail]);
        pts.push([xDrop, yTop]);
      } else {
        const yRow = (tb[1] + tb[3]) / 2;
        const sides = [
          { gutter: Math.max(pb[0] - 0.35, -7.85), xEnter: tb[0] },
          { gutter: Math.min(pb[2] + 0.35, 7.85), xEnter: tb[2] },
        ];
        let best: Array<[number, number]> | null = null;
        let bestLen = Infinity;
        for (const side of sides) {
          if (hits(side.gutter, yRail, yRow, target)) continue;
          const path: Array<[number, number]> = [[xTok, yRail], [side.gutter, yRail], [side.gutter, yRow], [side.xEnter, yRow]];
          let along = 0;
          for (let i = 0; i < path.length - 1; i++) {
            const p = path[i]!, q = path[i + 1]!;
            along += Math.hypot(q[0] - p[0], q[1] - p[1]);
          }
          if (along < bestLen) { bestLen = along; best = path; }
        }
        if (!best) throw new Error(`no clear side for ${JSON.stringify(token.text)}`);
        pts.push(...best);
      }
      const lines: Line[] = [];
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i]!, q = pts[i + 1]!;
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < 0.02) continue;
        len += d;
        lines.push(new Line(p, q, { stroke: color, strokeWidth: 0.045 }));
      }
      if (len > PHONE_CONNECTOR_MAX) throw new Error(`connector ${len.toFixed(2)} from ${JSON.stringify(token.text)}`);
      if (!lines.length) return;
      const path = new Group(...lines);
      wires.add(path);
      await this.play(new Create(path, { lagRatio: 0 }), { runTime: 0.35 });
    };

    const swapCode = async (
      file: string, line: number, source: string, token: string, color: string,
      alongside?: () => Transform[],
    ): Promise<Text> => {
      await clearLinks();
      const cite = mono(`${file}:${line}`, FS, DIM, 'start');
      cite.moveTo([INK_LEFT, TOP - 0.32], UL);
      const lines = fitCode(source, token, FS, MAX_W);
      const rows: Group[] = [];
      let tok: Text | null = null;
      let y = cite.bottom()[1] - 0.2;
      for (const lineText of lines) {
        const i = lineText.indexOf(token);
        const parts: Text[] = [];
        if (i < 0) parts.push(mono(lineText, FS, DIM, 'start'));
        else {
          if (i > 0) parts.push(mono(lineText.slice(0, i), FS, DIM, 'start'));
          const t = mono(token, FS, color, 'start');
          parts.push(t);
          tok = t;
          const rest = lineText.slice(i + token.length);
          if (rest) parts.push(mono(rest, FS, DIM, 'start'));
        }
        let x = 0;
        for (const p of parts) { p.moveTo([x, 0], LEFT); x += p.advance(); }
        const row = new Group(...parts);
        row.moveTo([INK_LEFT, y], UL);
        rows.push(row);
        y = row.bottom()[1] - 0.2;
      }
      if (!tok) throw new Error(`token ${token} missing after layout`);
      const next = new Group(cite, ...rows);
      next.layoutGroup = 'code';
      const out: FadeOut[] = [];
      if (code) out.push(new FadeOut(code));
      if (out.length) await this.play(...out, { runTime: 0.22 });
      code = next;
      const extra = alongside?.() ?? [];
      await this.play(new FadeIn(code), ...extra, { runTime: 0.35 });
      return tok;
    };

    const clearGraphic = async (): Promise<void> => {
      await clearLinks();
      if (!graphic.children.length) { picture = null; return; }
      await this.play(new FadeOut(graphic), { runTime: 0.25 });
      graphic.remove(...graphic.children.slice());
      picture = null;
      this.add(graphic);
    };

    const reveal = async (g: Group, datum?: Mobject, token?: Text): Promise<void> => {
      picture = g;
      graphic.add(g);
      place(g);
      if (datum && token) alignTo(g, datum, token);
      await this.play(new LaggedStart(g.children.map((c) => new FadeIn(c, { runTime: 0.26 })), { lagRatio: 0.05 }), { runTime: 0.65 });
    };

    const BAR_MAX = 13.4;
    const pushBar = async (ms: number, start: number, color: string, caption: string): Promise<{ bar: Rectangle; caption: Text }> => {
      const w = Math.max(0.5, (ms / 505) * BAR_MAX);
      const bar = new Rectangle({ width: w, height: 0.7, fill: color, fillOpacity: 0.94, stroke: 'none' });
      bar.measures = true;
      const cap = mono(caption, LABEL, color, 'start');
      bar.moveTo([0, 0], LEFT);
      cap.nextTo(bar, DOWN, 0.1, LEFT);
      const g = new Group(bar, cap);
      const yBottom = data.children.length && data.box() ? data.box()![3] + 0.16 : BOT + 0.26;
      g.shift([0, yBottom - g.bottom()[1]]);
      g.shift([-BAR_MAX / 2 - bar.left()[0], 0]);
      data.add(g);
      st.clockMs = start + ms;
      const lift = picture ? picture.animate.shift([0, seatDy(picture)]) : null;
      await this.play(new FadeIn(g), ...(lift ? [lift] : []), { runTime: 0.4 });
      return { bar, caption: cap };
    };

    // ---- url -----------------------------------------------------------------
    await this.step('url', { caption: 'owner/repo means GitHub. The paste becomes the path.', file: 'worker/viewer/paste.ts', line: 34 });
    const urlTok = await swapCode(
      'worker/viewer/paste.ts', 34,
      '  if (OWNER_REPO.test(text)) return { remote: `https://github.com/${text}` };',
      'github.com', TEAL,
    );
    const remote = mono('remote  github.com', LABEL, TEAL);
    remote.moveTo([0, BOT + 0.28 + remote.height() / 2]);
    data.add(remote);
    await this.play(new FadeIn(remote), { runTime: 0.25 });
    const urlHost = chip([[{ text: 'github.com', color: WHITE }]], TEAL);
    const urlPicture = pile([
      urlHost,
      chip([[{ text: '/view/', color: GOLD }]], GOLD),
      chip([[{ text: 'octocat', color: INK }]], DIM),
      chip([[{ text: 'Hello-World', color: INK }]], DIM),
    ]);
    await reveal(urlPicture, urlHost, urlTok);
    st.url = '/view/github.com/octocat/Hello-World';
    await link(urlTok, urlHost, TEAL);
    await this.wait(0.35);

    // ---- allow ---------------------------------------------------------------
    await this.step('allow', { caption: 'Exact match only. A trailing dot is a different host.', file: 'worker/viewer/url.ts', line: 79 });
    await clearGraphic();
    const allowTok = await swapCode(
      'worker/viewer/url.ts', 79,
      '  for (const item of allowed) if (item === host) return true;',
      'item === host', TEAL,
    );
    const hostNames = ['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org', 'git.sr.ht', 'github.com.'] as const;
    const hostChips = hostNames.map((n, i) => chip(
      [[{ text: n, color: i === hostNames.length - 1 ? RED : WHITE }]],
      i === 0 ? TEAL : i === hostNames.length - 1 ? RED : DIM,
    ));
    let hosts = pile(hostChips);
    await reveal(hosts, hostChips[0]!, allowTok);
    const kept = hostChips.slice(0, 5);
    const bad = hostChips[5]!;
    const nextHosts = pile(kept.map((c) => c.copy()));
    place(nextHosts);
    alignTo(nextHosts, nextHosts.children[0]!, allowTok);
    await this.play(
      new FadeOut(bad),
      ...kept.map((c, i) => new Transform(c, nextHosts.children[i]!)),
      { runTime: 0.45 },
    );
    hosts.remove(bad);
    st.host = 'github.com';
    await link(allowTok, hostChips[0]!, TEAL);
    const hostLine = mono('host  github.com', LABEL, TEAL);
    hostLine.moveTo(remote);
    await this.play(new Transform(remote, hostLine), { runTime: 0.35 });
    await this.wait(0.35);

    // ---- strip ---------------------------------------------------------------
    await this.step('strip', { caption: 'Credentials leave the request. User-Agent is forced.', file: 'worker/viewer/fetchguard.ts', line: 18 });
    await clearGraphic();
    await this.play(new FadeOut(remote), { runTime: 0.2 });
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
    let form = layForm(fields);
    let live = fields.slice();
    const sheet = form.group;
    picture = sheet;
    graphic.add(sheet);
    place(sheet);
    await this.play(new LaggedStart([form.frame, ...form.rows.map((r) => r.group)].map((m) => new FadeIn(m, { runTime: 0.24 })), { lagRatio: 0.06 }), { runTime: 0.7 });
    const allowHit = code!.family().find((m) => m instanceof Text && m.text === 'ALLOWED.has');
    if (!(allowHit instanceof Text)) throw new Error('ALLOWED.has');
    await link(allowHit, form.frame, ORANGE);
    await clearLinks();
    const dropped: string[] = [];
    for (const spec of fields.filter((f) => f.credential)) {
      const idx = live.indexOf(spec);
      const row = form.rows[idx]!;
      const stay = live.filter((f) => f !== spec);
      const next = layForm(stay);
      next.group.moveTo([sheet.center()[0], 0]);
      next.group.shift([0, sheet.top()[1] - next.group.top()[1]]);
      const stayRows = form.rows.filter((_, i) => i !== idx);
      await this.play(
        new FadeOut(row.group),
        new Transform(form.frame, next.frame),
        ...stayRows.flatMap((r, i) => childAnims(r.group, next.rows[i]!.group)),
        { runTime: 0.42 },
      );
      form = { frame: form.frame, rows: stayRows, group: sheet };
      live = stay;
      dropped.push(spec.name);
      st.dropped = dropped.join(' ');
    }
    const strippedChips = [
      chip([[{ text: 'stripped', color: DIM }]], DIM),
      ...dropped.map((name) => chip([[{ text: name, color: ORANGE }]], ORANGE)),
    ];
    const stripped = pile(strippedChips, 'left');
    stripped.nextTo(sheet, DOWN, 0.2, LEFT);
    graphic.add(stripped);
    await this.play(new FadeIn(stripped), { runTime: 0.35 });
    const holder = new Group(sheet, stripped);
    graphic.add(holder);
    const uaTok = await swapCode(
      'worker/viewer/fetchguard.ts', 20,
      "  out.set('user-agent', VIEWER_UA);",
      'VIEWER_UA', GOLD,
      () => {
        const dy = seatDy(holder);
        if (Math.abs(dy) < 0.04) return [];
        const moved = holder.copy();
        moved.shift([0, dy]);
        return [new Transform(holder, moved)];
      },
    );
    const uaRow = form.rows[live.length - 1]!;
    const uaValue = uaRow.value;
    if (!uaValue) throw new Error('user-agent value');
    const uaNext = uaValue.copy();
    uaNext.setText('ply-viewer/0.1.0');
    uaNext.setFill(GOLD);
    await this.play(new Transform(uaValue, uaNext), { runTime: 0.35 });
    // The forced header is the datum, so it moves to the top of the card where the line can meet it.
    const above = form.rows.slice(0, -1);
    let y = above[0] ? above[0].group.top()[1] : uaRow.group.top()[1];
    const liftRows: Array<ReturnType<Group['animate']['shift']>> = [];
    for (const row of [uaRow, ...above]) {
      const dy = y - row.group.top()[1];
      if (Math.abs(dy) > 0.02) liftRows.push(row.group.animate.shift([0, dy]));
      y -= row.group.height() + 0.14;
    }
    if (liftRows.length) await this.play(...liftRows, { runTime: 0.4 });
    await link(uaTok, uaRow.shape, GOLD);
    await this.wait(0.35);

    // ---- refs ----------------------------------------------------------------
    await this.step('refs', { caption: 'listRefs asks for HEAD and refs/heads/.', file: 'worker/viewer/session.ts', line: 185 });
    await clearGraphic();
    const refTok = await swapCode(
      'worker/viewer/session.ts', 185,
      '  const listedRefs = await listRefs(transport, refPrefixes(route.ref));',
      'refPrefixes', TEAL,
    );
    const refHead = pktChip('ref-prefix HEAD\n', TEAL);
    const refHeads = pktChip('ref-prefix refs/heads/\n', TEAL);
    const refPicture = pile([
      pktChip('command=ls-refs\n', INK),
      pktChip('', GOLD, '0001'),
      pktChip('peel\n', DIM),
      pktChip('symrefs\n', DIM),
      refHead,
      refHeads,
      pktChip('', GOLD, '0000'),
    ], 'left');
    // refPrefixes writes both lines. The heads line is the one a vertical drop can meet.
    await reveal(refPicture, refHeads, refTok);
    st.pkt = '0014command=ls-refs 0001 0009peel 000csymrefs 0014ref-prefix HEAD 001bref-prefix refs/heads/ 0000';
    await pushBar(438, 0, TEAL, 'ls-refs · 438 ms');
    await link(refTok, refHeads, TEAL);
    await this.wait(0.35);

    // ---- fetch ---------------------------------------------------------------
    await this.step('fetch', { caption: 'The commit fetch asks for filter tree:0.', file: 'worker/viewer/session.ts', line: 187 });
    await clearGraphic();
    const fetchTok = await swapCode(
      'worker/viewer/session.ts', 187,
      "  const commitObj = await readObject(transport, { oid: resolved.commit, filter: 'tree:0', deepen: 1, expectType: TYPE.COMMIT });",
      "filter: 'tree:0'", GREEN,
    );
    const fetchPicture = fetchColumn('tree:0');
    await reveal(fetchPicture.group, fetchPicture.filter, fetchTok);
    const treeBar = await pushBar(443, 438, GREEN, 'tree:0 · 443 ms');
    const redBar = treeBar.bar.copy();
    redBar.setFill(RED);
    const denied = treeBar.caption.copy();
    denied.setText('400 filter not allowed · 443 ms');
    denied.setFill(RED);
    await this.play(new Transform(treeBar.bar, redBar), new Transform(treeBar.caption, denied), { runTime: 0.45 });
    st.filter = 'tree:0';
    st.http = 400;
    await link(fetchTok, fetchPicture.filter, GREEN);
    await this.wait(0.35);

    // ---- retry ---------------------------------------------------------------
    await this.step('retry', { caption: 'That answer is the rejection. The retry is blob:none.', file: 'src/fetch.js', line: 176 });
    await clearGraphic();
    const retryTok = await swapCode(
      'src/fetch.js', 176,
      "    if (t.quirks) t.quirks.treeFilter = 'blob:none';",
      'blob:none', TEAL,
    );
    const retryPicture = fetchColumn('blob:none');
    await reveal(retryPicture.group, retryPicture.filter, retryTok);
    await pushBar(505, 881, TEAL, '200 · blob:none · 505 ms');
    st.filter = 'blob:none';
    st.http = 200;
    await link(retryTok, retryPicture.filter, TEAL);
    await this.wait(0.35);

    // ---- pack ----------------------------------------------------------------
    await this.step('pack', { caption: 'parsePack records each object offset as the bytes arrive.', file: 'src/packresolve.js', line: 38 });
    await clearGraphic();
    const offTok = await swapCode(
      'src/packresolve.js', 38,
      '    const offset = p;',
      'offset', BLUE,
    );
    const barW = 13.2;
    const packH = 0.9;
    const x0 = -barW / 2;
    const slices: Rectangle[] = [];
    const paint = (offset: number, length: number, fill: string, key: string): void => {
      const w = Math.max(0.05, (length / PACK_BYTES) * barW);
      const rect = new Rectangle({ width: w, height: packH, fill, fillOpacity: 0.94, stroke: 'none' });
      rect.measures = true;
      rect.key = key;
      rect.moveTo([x0 + (offset / PACK_BYTES) * barW, 0], LEFT);
      slices.push(rect);
    };
    paint(0, PACK_HEADER, '#5c5c5c', 'pack:header');
    for (const obj of PACK_OBJECTS) paint(obj.offset, obj.length, kindColor(obj.kind), `pack:${obj.offset}`);
    paint(PACK_BYTES - PACK_TRAILER, PACK_TRAILER, '#5c5c5c', 'pack:trailer');
    const packBar = new Group(...slices);
    const legend = pile([
      chip([[{ text: `${PACK_BYTES} B · ${PACK_OBJECTS.length} objects`, color: DIM }]], DIM),
      chip([[{ text: legendText(commitObj), color: WHITE }]], BLUE),
      chip([[{ text: legendText(refDelta), color: RED }]], RED),
      chip([[{ text: legendText(treeObj), color: WHITE }]], GREEN),
    ], 'left');
    legend.nextTo(packBar, DOWN, 0.2, LEFT);
    const pack = new Group(packBar, legend);
    await reveal(pack);
    st.pack = `${PACK_BYTES} B @${commitObj.offset} ${commitObj.length} @${refDelta.offset} ${refDelta.length} @${treeObj.offset} ${treeObj.length}`;
    const commitSlice = slices.find((s) => s.key === `pack:${commitObj.offset}`)!;
    await link(offTok, commitSlice, BLUE);
    const reseatPack = (): Transform[] => {
      if (!picture) return [];
      const dy = seatDy(picture);
      if (Math.abs(dy) < 0.04) return [];
      const moved = picture.copy();
      moved.shift([0, dy]);
      return [new Transform(picture, moved)];
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
    const refSlice = slices.find((s) => s.key === `pack:${refDelta.offset}`)!;
    const arc = new CurvedArrow(
      [refSlice.center()[0], refSlice.top()[1] + 0.16],
      [commitSlice.center()[0], commitSlice.top()[1] + 0.16],
      { angle: Math.PI / 7, stroke: RED, strokeWidth: 0.045, tipLength: 0.18, tipWidth: 0.12 },
    );
    pack.add(arc);
    await this.play(new Create(arc), { runTime: 0.6 });
    await link(baseTok, refSlice, RED, refSlice.right()[0] - 0.18);
    const applyTok = await swapCode(
      'src/packresolve.js', 154,
      '      const { out, ops } = applyDelta(base.data, obj.data, { maxResult: limits.maxDeltaResult });',
      'applyDelta', BLUE,
      reseatPack,
    );
    await link(applyTok, commitSlice, BLUE, commitSlice.left()[0] + 0.28);
    st.delta = `@${refDelta.offset} -> @${commitObj.offset} chain 1`;
    await this.wait(0.35);

    // ---- trace ---------------------------------------------------------------
    await this.step('trace', { caption: 'The measured calls, after discover. 438, then 443, then 505.', file: 'src/otel.js', line: 48 });
    await clearGraphic();
    const spanTok = await swapCode(
      'src/otel.js', 48,
      '  async span(name, opts, fn) {',
      'span', GOLD,
    );
    const spanLead = chip([[{ text: 'ls-refs · 438 ms', color: TEAL }]], TEAL);
    const tracePicture = pile([
      spanLead,
      chip([[{ text: '400 · tree:0 · 443 ms', color: RED }]], RED),
      chip([[{ text: '200 · blob:none · 505 ms', color: TEAL }]], TEAL),
    ]);
    await reveal(tracePicture, spanLead, spanTok);
    await link(spanTok, spanLead, GOLD);
    await this.wait(0.35);

    // ---- pipeline ------------------------------------------------------------
    await this.step('pipeline', { caption: 'Fresh quirks, so this request still shows the retry.', file: 'worker/viewer/session.ts', line: 302 });
    await clearGraphic();
    const endTok = await swapCode(
      'worker/viewer/session.ts', 302,
      '  const quirks: Quirks = {};',
      'quirks', WHITE,
    );
    const retryChip = chip([[{ text: '400', color: WHITE }]], RED);
    const stagePicture = pile([
      chip([[{ text: 'github.com', color: WHITE }]], TEAL),
      chip([[{ text: 'strip', color: WHITE }]], ORANGE),
      chip([[{ text: 'ls-refs', color: WHITE }]], TEAL),
      retryChip,
      chip([[{ text: '200', color: WHITE }]], TEAL),
      chip([[{ text: `@${commitObj.offset}`, color: WHITE }]], BLUE),
      chip([[{ text: '1.4 s', color: INK }]], GOLD),
    ]);
    await reveal(stagePicture);
    await link(endTok, retryChip, RED);
    await this.wait(0.35);
  }
}
