// ply /view, on a phone canvas.
//
// The public viewer is moving from ivarvong/ply to ivarvong/ply-web. ply-web has
// no commits yet, so every quoted line is from ivarvong/ply pull/2 at
// 3f07a75c667ab8afad9e91d396836eb21abb1b8f. The page stays
// ply.ivar.workers.dev/view.
//
// The camera is the 390×844 phone, not a 16:9 stage letterboxed onto one.
// Code sits at the top, the picture in the middle, the trace at the bottom.
// Colors are the concept, on every pane:
//   host / ls-refs / blob:none retry = teal,  tree / tree:0 = green,
//   commit / offset = blue,  ref-delta = red,  credential = orange,
//   blob bytes = grey,  pkt length / span = gold,  HTTP 400 = red.
import {
  Scene, Group, Text, Rectangle, Arrow, CurvedArrow, Labeled, FadeIn, FadeOut, Create, Transform, LaggedStart,
  Card, route, obstacles, linear, LEFT,
  BLUE, TEAL, GREEN, RED, GREY, WHITE, ORANGE, GOLD,
} from '../src/index.ts';
import type { Sink, SceneOptions, Mobject, PathFunc } from '../src/index.ts';

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

function buildLine(source: string, token: string, color: string, codeY: number): { group: Group; token: Text } {
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
  group.shift([0, codeY - rows[0]!.center()[1]]);
  return { group, token: tok };
}

function cite(file: string, line: number, y: number): Text {
  return mono(`${file}:${line}`, 0.5, DIM, 'start').moveTo([INK_LEFT, y], LEFT);
}

/**
 * Down off the code line, across, then down. A straight blend from the source
 * into the card would carry the token through the rows.
 */
const elbow: PathFunc = (a, b, t) => {
  const split = 0.48;
  if (t < split) {
    const u = t / split;
    return [a[0] + (b[0] - a[0]) * u, a[1]];
  }
  const u = (t - split) / (1 - split);
  return [b[0], a[1] + (b[1] - a[1]) * u];
};

function chip(label: string, color: string, fontSize = 0.4): Labeled<Rectangle, Text> {
  const t = mono(label, fontSize, WHITE);
  const r = new Rectangle({
    width: t.advance() + 0.55, height: t.height() + 0.36, cornerRadius: 0.12,
    stroke: color, strokeWidth: 0.05, fill: color, fillOpacity: 0.16,
  });
  return new Labeled(r, t);
}

/** How long a move of `distance` scene units can take without a one-frame spike. */
function glide(distance: number): number {
  return Math.min(2.05, Math.max(0.55, distance * 0.42));
}

/** A left-aligned stack whose bottom edge sits on `bottom`. */
function column(lines: Array<{ text: string; color: string; fs: number }>, left: number, bottom: number): Group {
  const texts = lines.map((l) => mono(l.text, l.fs, l.color, 'start'));
  const gap = 0.2;
  const h = texts.reduce((s, t) => s + t.height(), 0) + gap * Math.max(0, texts.length - 1);
  let y = bottom + h;
  for (const t of texts) {
    y -= t.height() / 2;
    t.moveTo([left, y], LEFT);
    y -= t.height() / 2 + gap;
  }
  return new Group(...texts);
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
    const CITE_Y = TOP - 0.78;
    const CODE_Y = TOP - 2.25;
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
    const link = async (from: Mobject, to: Mobject, color: string, dock: 'auto' | 'side' | 'facing' = 'auto'): Promise<Group> => {
      const roots: Mobject[] = [graphic, data];
      if (code) roots.push(code);
      if (citeT) roots.push(citeT);
      const avoid = obstacles(roots, [from, to], (m) => m.style.opacity ?? 1);
      const path = route(from, to, avoid, { stroke: color, strokeWidth: 0.05, clearance: 0.08, dock, bounds: cam });
      links.push(path);
      await this.play(new Create(path, { lagRatio: 0 }), { runTime: 0.45 });
      return path;
    };
    const swapCode = async (file: string, line: number, source: string, token: string, color: string): Promise<Text> => {
      await clearLinks();
      const next = buildLine(source, token, color, CODE_Y);
      const nextCite = cite(file, line, CITE_Y);
      const out: FadeOut[] = [];
      if (code) out.push(new FadeOut(code));
      if (citeT) out.push(new FadeOut(citeT));
      if (out.length) await this.play(...out, { runTime: 0.28 });
      code = next.group;
      citeT = nextCite;
      await this.play(new FadeIn(code), new FadeIn(citeT), { runTime: 0.35 });
      return next.token;
    };
    const clearGraphic = async (): Promise<void> => {
      await clearLinks();
      if (!graphic.children.length) return;
      await this.play(new FadeOut(graphic), { runTime: 0.3 });
      graphic.remove(...graphic.children.slice());
      this.add(graphic);
    };
    const depart = async (token: Text, to: Readonly<[number, number]>, opts: { text?: string; color?: string; scale?: number; runTime?: number } = {}): Promise<{ flown: Text; home: Text }> => {
      const parent = token.parent;
      const home = token.copy();
      const target = token.copy();
      if (opts.text) target.setText(opts.text);
      if (opts.color) target.setFill(opts.color);
      if (opts.scale && opts.scale !== 1) target.scale(opts.scale);
      target.moveTo(to);
      const d = Math.hypot(to[0] - token.center()[0], to[1] - token.center()[1]);
      await this.play(new Transform(token, target), { runTime: opts.runTime ?? glide(d) });
      graphic.add(token);
      if (parent) {
        await this.play(new FadeIn(home), { runTime: 0.3 });
        this.remove(home);
        parent.add(home);
      }
      return { flown: token, home };
    };
    const pinBottom = (t: Text, y = BOT + 0.7): Text => {
      t.moveTo([0, y + t.height() / 2]);
      return t;
    };

    // Trace bars stack upward from the bottom. One caption each, on the bar.
    const total = 1386;
    const bx0 = -7.35;
    const bScale = 8.6 / 505;
    const barH = 1.05;
    const pitch = 2.55;
    const base = BOT + 2.15;
    const barGroups: Group[] = [];
    const CAP = fitSize('400 filter not allowed · 443 ms', 14.6, 0.82);
    const growBar = async (ms: number, start: number, color: string, name: string): Promise<{ group: Group; bar: Rectangle; caption: Text }> => {
      // Newest row sits closest to the picture. A connector drops onto it
      // without crossing the older rows underneath.
      const y = base + barGroups.length * pitch;
      const w = Math.max(0.4, ms * bScale);
      const full = new Rectangle({ width: w, height: barH, fill: color, fillOpacity: 0.94, stroke: 'none' });
      full.moveTo([bx0, y], LEFT);
      const bar = full.copy();
      bar.stretch(0.08 / w, 0, { aboutEdge: LEFT });
      const g = new Group(bar);
      data.add(g);
      barGroups.push(g);
      await this.play(new FadeIn(bar), { runTime: 0.16 });
      await this.play(new Transform(bar, full), { runTime: 0.7, rateFunc: linear });
      const caption = mono(name, CAP, color, 'start');
      caption.moveTo([bx0, y - barH / 2 - 0.16 - caption.height() / 2], LEFT);
      g.add(caption);
      await this.play(new FadeIn(caption), { runTime: 0.25 });
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
    const HERO = fitSize('/octocat/Hello-World', 14.2, 1.35);
    const piece = (s: string, color: string) => mono(s, HERO, color);
    const view = piece('/view/', GOLD);
    const hostSlot = piece('github.com', TEAL);
    const slash0 = piece('/', INK);
    const octo = piece('octocat', INK);
    const slash = piece('/', INK);
    const hello = piece('Hello-World', INK);
    const layRow = (parts: Text[], y: number): void => {
      const gap = 0.08;
      const w = parts.reduce((s, p) => s + p.advance(), 0) + gap * (parts.length - 1);
      let x = -w / 2;
      for (const p of parts) { p.moveTo([x, y], LEFT); x += p.advance() + gap; }
    };
    const line2 = [slash0, octo, slash, hello];
    // Low enough that code plus the path already cover the phone, before the state line.
    const heroY = -5.2;
    layRow(line2, heroY);
    graphic.add(...line2);
    await this.play(new LaggedStart(line2.map((t) => new FadeIn(t, { runTime: 0.35 })), { lagRatio: 0.2 }));
    const line1 = [view, hostSlot];
    layRow(line1, heroY + HERO * 1.35);
    const hostAt = hostSlot.center().slice() as [number, number];
    const { flown: hostTok, home: hostHome } = await depart(urlTok, hostAt, { color: TEAL, scale: HERO / FS });
    // FadeIn copies the mobject as its target, so it has to be opaque here.
    // Adding it in the same turn as the fade means no frame shows it already drawn.
    graphic.add(view);
    view.setOpacity(1);
    await this.play(new FadeIn(view), { runTime: 0.35 });
    st.url = '/view/github.com/octocat/Hello-World';
    await link(hostHome, hostTok, TEAL);
    const remote = pinBottom(mono('remote  github.com', fitSize('remote  github.com', 14.2, 1.2), TEAL));
    graphic.add(remote);
    await this.play(new FadeIn(remote), { runTime: 0.3 });
    await this.wait(0.4);

    // ---- allow ---------------------------------------------------------------
    await this.step('allow', { caption: 'Exact match only. A trailing dot is a different host.', file: 'worker/viewer/url.ts', line: 79 });
    await clearLinks();
    const allowTok = await swapCode(
      'worker/viewer/url.ts', 79,
      '  for (const item of allowed) if (item === host) return true;',
      'item === host', TEAL,
    );
    const pathBits = [view, hostTok, ...line2];
    const pathLow = Math.min(...pathBits.map((t) => t.bottom()[1]));
    await this.play(...pathBits.map((t) => t.animate.shift([0, 7.6 - pathLow])), { runTime: 0.6 });
    const names = ['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org', 'git.sr.ht'] as const;
    const hostFs = 0.78;
    const hosts = names.map((n, i) => chip(n, i === 0 ? TEAL : DIM, hostFs));
    let hy = 2.4;
    for (const h of hosts) { h.moveTo([0, hy]); hy -= h.height() + 0.28; }
    graphic.add(...hosts);
    await this.play(new LaggedStart(hosts.map((h) => new FadeIn(h)), { lagRatio: 0.12 }), { runTime: 0.8 });
    const gh = hosts[0]!;
    // The chip already reads github.com. A second copy on top of that label is
    // the same word twice. Highlight the row; the path keeps its own host.
    await this.play(gh.shape.animate.setStyle({ stroke: TEAL, fill: TEAL, fillOpacity: 0.28 }), { runTime: 0.4 });
    st.host = 'github.com';
    await link(allowTok, gh, TEAL);
    const hostLine = mono('host  github.com', fitSize('host  github.com', 14.2, 1.2), TEAL);
    pinBottom(hostLine);
    await this.play(new Transform(remote, hostLine), { runTime: 0.45 });
    const bad = mono('github.com.', 0.72, RED);
    bad.moveTo([0, hy - 0.2]);
    const badEnd = bad.copy();
    badEnd.shift([0, -1.4]);
    for (const m of badEnd.family()) m.style.opacity = 0;
    graphic.add(bad);
    await this.play(new FadeIn(bad), { runTime: 0.25 });
    await this.play(new Transform(bad, badEnd), { runTime: 0.55, rateFunc: linear });
    this.remove(bad);
    await this.wait(0.4);

    // ---- strip ---------------------------------------------------------------
    await this.step('strip', { caption: 'Credentials leave the request. User-Agent is forced.', file: 'worker/viewer/fetchguard.ts', line: 18 });
    await clearGraphic();
    const stripTok = await swapCode(
      'worker/viewer/fetchguard.ts', 18,
      '    if (ALLOWED.has(key.toLowerCase())) out.set(key, value);',
      'ALLOWED.has', ORANGE,
    );
    const ROW_FS = 0.7;
    type RowSpec = { name: string; value: string; nameColor: string; valueColor: string; credential: boolean };
    const specs: RowSpec[] = [
      { name: 'Authorization', value: '<client>', nameColor: ORANGE, valueColor: ORANGE, credential: true },
      { name: 'Cookie', value: '<client>', nameColor: ORANGE, valueColor: ORANGE, credential: true },
      { name: 'Git-Token', value: '<client>', nameColor: ORANGE, valueColor: ORANGE, credential: true },
      { name: 'Git-Authorization', value: '<client>', nameColor: ORANGE, valueColor: ORANGE, credential: true },
      { name: 'accept', value: '*/*', nameColor: TEAL, valueColor: INK, credential: false },
      { name: 'git-protocol', value: 'version=2', nameColor: TEAL, valueColor: INK, credential: false },
      { name: 'user-agent', value: '<client>', nameColor: INK, valueColor: DIM, credential: false },
    ];
    const built = specs.map((s) => {
      const name = mono(s.name, ROW_FS, s.nameColor, 'start');
      const value = mono(s.value, ROW_FS, s.valueColor, 'start');
      name.moveTo([0, 0], LEFT);
      value.moveTo([0.16, -(name.height() + 0.08 + value.height() / 2)], LEFT);
      return { ...s, label: s.name, name, value, row: new Group(name, value) };
    });
    const card = new Card({
      padding: 0.36, gap: 0.22, align: 'start', cornerRadius: 0.14,
      stroke: ORANGE, strokeWidth: 0.05, fill: ORANGE, fillOpacity: 0.06,
    });
    card.layout(built.map((b) => b.row));
    card.shift([INK_LEFT - card.frame.left()[0], 11.6 - card.frame.top()[1]]);
    graphic.add(card);
    await this.play(
      new FadeIn(card.frame, { runTime: 0.35 }),
      new LaggedStart(built.map((b) => new FadeIn(b.row, { runTime: 0.3 })), { lagRatio: 0.12 }),
    );
    await link(stripTok, card.frame, ORANGE, 'facing');
    await clearLinks();
    // Top row first, straight up out of the card. The card closes only after
    // the row has cleared the top, so it never falls through the rows below.
    const dropped: string[] = [];
    for (const b of built.filter((r) => r.credential)) {
      const stay = card.rows.filter((r) => r !== b.row);
      const plan = card.plan(stay, 'top');
      const dy1 = (card.frame.top()[1] + b.row.height() / 2 + 0.5) - b.row.center()[1];
      const gone = b.row.copy();
      gone.shift([0, dy1 + 0.9]);
      for (const m of gone.family()) m.style.opacity = 0;
      // Rise clear of the top, then the card closes while the row is still moving
      // and still bright enough to count as leaving. A gap with the row already
      // gone and the frame not yet shut is the sunk-card failure.
      const exit = new Transform(b.row, gone, {
        pathFunc: (a, end, t) => {
          const riseEnd = 0.36;
          const gateY = a[1] + dy1;
          if (t < riseEnd) {
            const u = t / riseEnd;
            return [a[0], a[1] + (gateY - a[1]) * u];
          }
          const u = (t - riseEnd) / (1 - riseEnd);
          return [a[0], gateY + (end[1] - gateY) * u];
        },
      });
      exit.rateFunc = linear;
      const after = (t: number): number => (t < 0.4 ? 0 : Math.min(1, (t - 0.4) / 0.36));
      const frameAnim = new Transform(card.frame, card.frameTarget(plan));
      frameAnim.rateFunc = after;
      const movers = stay.map((r, i) => {
        const anim = new Transform(r, r.copy().moveTo(plan.anchors[i]!, LEFT));
        anim.rateFunc = after;
        return anim;
      });
      await this.play(exit, frameAnim, ...movers, { runTime: 0.72 });
      this.remove(b.row);
      dropped.push(b.label);
      st.dropped = dropped.join(' ');
    }
    // The short card was pinned under the code. Drop it into the middle so the
    // request is the body and the stripped names can sit at the bottom.
    const cardDy = -1.6 - card.frame.center()[1];
    if (Math.abs(cardDy) > 0.3) await this.play(card.animate.shift([0, cardDy]), { runTime: 0.55 });
    const uaTok = await swapCode(
      'worker/viewer/fetchguard.ts', 20,
      "  out.set('user-agent', VIEWER_UA);",
      'VIEWER_UA', GOLD,
    );
    const ua = built[built.length - 1]!;
    // <client> stays until the token lands. Fading it first left the card tall
    // with an empty slot, which is the sunk-card fill.
    const measures = card.rows.map((r) => {
      const copy = r.copy();
      if (r === ua.row) {
        const name = copy.children[0] as Text;
        const value = mono('ply-viewer/0.1.0', ROW_FS, GOLD, 'start');
        value.moveTo([name.left()[0] + 0.16, name.bottom()[1] - 0.08 - value.height() / 2], LEFT);
        if (copy.children[1]) copy.remove(copy.children[1]);
        copy.add(value);
      }
      return copy;
    });
    const grown = card.plan(measures, 'top');
    const uaIndex = card.rows.indexOf(ua.row);
    const anchor = grown.anchors[uaIndex]!;
    const home = uaTok.copy();
    const parent = uaTok.parent;
    const dipped = uaTok.copy();
    dipped.scale(ROW_FS / FS);
    const gapY = card.frame.top()[1] + dipped.height() / 2 + 0.5;
    dipped.moveTo([uaTok.center()[0], gapY]);
    await this.play(new Transform(uaTok, dipped), { runTime: 0.4 });
    if (parent) {
      await this.play(new FadeIn(home), { runTime: 0.25 });
      this.remove(home);
      parent.add(home);
    }
    const finalRight = grown.frameCenter[0] + grown.width / 2;
    const door = uaTok.copy();
    const half = uaTok.width() / 2;
    const doorX = Math.min(cam.w / 2 - half - 0.12, Math.max(card.frame.right()[0], finalRight) + 0.35 + half);
    door.moveTo([doorX, anchor[1]]);
    const fly = new Transform(uaTok, door, { pathFunc: elbow });
    fly.rateFunc = linear;
    await this.play(fly, { runTime: 0.7 });
    // The token replaces <client>. The old value fades beside the row, so the
    // card's resize and the token's landing are one gesture and the frame is
    // never left open around an empty slot.
    ua.row.remove(ua.value);
    graphic.add(ua.value);
    ua.row.add(uaTok);
    const uaTarget = ua.row.copy();
    uaTarget.moveTo(anchor, LEFT);
    const nameT = uaTarget.children[0] as Text;
    const tokT = uaTarget.children[1] as Text;
    tokT.setText('ply-viewer/0.1.0');
    tokT.setFill(GOLD);
    tokT.moveTo([nameT.left()[0] + 0.16, nameT.bottom()[1] - 0.08 - tokT.height() / 2], LEFT);
    const grow = new Transform(card.frame, card.frameTarget(grown));
    const shiftRows = card.rows.filter((r) => r !== ua.row).map((r) => {
      const at = grown.anchors[card.rows.indexOf(r)]!;
      return new Transform(r, r.copy().moveTo(at, LEFT));
    });
    const dropValue = new FadeOut(ua.value);
    dropValue.rateFunc = (t) => Math.min(1, t / 0.3);
    await this.play(new Transform(ua.row, uaTarget), grow, dropValue, ...shiftRows, { runTime: 0.8 });
    await link(home, uaTok, GOLD, 'side');
    const stripped = column([
      { text: 'stripped', color: DIM, fs: 0.58 },
      ...dropped.map((name) => ({ text: name, color: ORANGE, fs: fitSize('Git-Authorization', 13.5, 0.95) })),
    ], INK_LEFT, BOT + 0.55);
    graphic.add(stripped);
    await this.play(new FadeIn(stripped), { runTime: 0.4 });
    await this.wait(0.4);

    // ---- refs ----------------------------------------------------------------
    await this.step('refs', { caption: 'listRefs asks for HEAD and refs/heads/.', file: 'worker/viewer/session.ts', line: 185 });
    await clearGraphic();
    const refTok = await swapCode(
      'worker/viewer/session.ts', 185,
      '  const listedRefs = await listRefs(transport, refPrefixes(route.ref));',
      'refPrefixes', TEAL,
    );
    const refLines: Array<{ payload: string; color: string; hex?: string }> = [
      { payload: 'command=ls-refs\n', color: INK },
      { payload: '', color: GOLD, hex: '0001' },
      { payload: 'peel\n', color: DIM },
      { payload: 'symrefs\n', color: DIM },
      { payload: 'ref-prefix HEAD\n', color: TEAL },
      { payload: 'ref-prefix refs/heads/\n', color: TEAL },
      { payload: '', color: GOLD, hex: '0000' },
    ];
    const PKT = fitSize('001b ref-prefix refs/heads/', 13.6, 0.86);
    const pktRows: Group[] = [];
    let headsPkt: Group | null = null;
    for (const spec of refLines) {
      const framed = spec.payload ? pktLine(spec.payload) : { hex: spec.hex!, body: '' };
      const hex = mono(framed.hex, PKT, GOLD, 'start');
      const body = framed.body ? mono(framed.body, PKT, spec.color, 'start') : null;
      hex.moveTo([0, 0], LEFT);
      if (body) body.moveTo([hex.advance() + 0.3, 0], LEFT);
      const g = new Group(hex, ...(body ? [body] : []));
      if (spec.payload.startsWith('ref-prefix refs/heads/')) headsPkt = g;
      pktRows.push(g);
    }
    const pktGap = 0.24;
    const pktH = pktRows.reduce((s, g) => s + g.height(), 0) + pktGap * (pktRows.length - 1);
    let py = -1.6 + pktH / 2;
    for (const g of pktRows) {
      py -= g.height() / 2;
      g.moveTo([INK_LEFT, py], LEFT);
      py -= g.height() / 2 + pktGap;
    }
    const pktBlock = new Group(...pktRows);
    graphic.add(pktBlock);
    await this.play(new LaggedStart(pktRows.map((g) => new FadeIn(g)), { lagRatio: 0.12 }), { runTime: 1.1 });
    st.pkt = '0014command=ls-refs 0001 0009peel 000csymrefs 0014ref-prefix HEAD 001bref-prefix refs/heads/ 0000';
    await link(refTok, headsPkt!, TEAL, 'side');
    const refsBar = await growBar(438, 0, TEAL, 'ls-refs · 438 ms');
    await link(headsPkt!, refsBar.bar, TEAL);
    await this.wait(0.4);

    // ---- fetch ---------------------------------------------------------------
    await this.step('fetch', { caption: 'The commit fetch asks for filter tree:0.', file: 'worker/viewer/session.ts', line: 187 });
    await clearGraphic();
    const fetchTok = await swapCode(
      'worker/viewer/session.ts', 187,
      "  const commitObj = await readObject(transport, { oid: resolved.commit, filter: 'tree:0', deepen: 1, expectType: TYPE.COMMIT });",
      "filter: 'tree:0'", GREEN,
    );
    const treePktText = pktLine('filter tree:0\n');
    const treeLabel = `${treePktText.hex} ${treePktText.body}`;
    const treeFs = fitSize(treeLabel, 14.2, 0.95);
    const { flown: treePkt, home: treeHome } = await depart(fetchTok, [0, 2.4], {
      text: treeLabel, color: GREEN, scale: treeFs / FS, runTime: 1.05,
    });
    await link(treeHome, treePkt, GREEN);
    const treeBar = await growBar(443, 438, GREEN, 'tree:0 · 443 ms');
    const redBar = treeBar.bar.copy();
    redBar.setFill(RED);
    const denied = mono('400 filter not allowed · 443 ms', CAP, RED, 'start');
    denied.moveTo(treeBar.caption, LEFT);
    await this.play(new Transform(treeBar.bar, redBar), new Transform(treeBar.caption, denied), { runTime: 0.55 });
    st.filter = 'tree:0';
    st.http = 400;
    await link(treePkt, treeBar.bar, RED);
    await this.wait(0.4);

    // ---- retry ---------------------------------------------------------------
    await this.step('retry', { caption: 'That answer is the rejection. The retry is blob:none.', file: 'src/fetch.js', line: 176 });
    await clearLinks();
    await this.play(new FadeOut(treePkt), { runTime: 0.25 });
    const retryTok = await swapCode(
      'src/fetch.js', 176,
      "    if (t.quirks) t.quirks.treeFilter = 'blob:none';",
      'blob:none', TEAL,
    );
    const blobPktText = pktLine('filter blob:none\n');
    const blobLabel = `${blobPktText.hex} ${blobPktText.body}`;
    const blobFs = fitSize(blobLabel, 14.2, 0.95);
    const { flown: blobPkt, home: blobHome } = await depart(retryTok, [0, 2.4], {
      text: blobLabel, color: TEAL, scale: blobFs / FS, runTime: 1.0,
    });
    await link(blobHome, blobPkt, TEAL);
    const blobBar = await growBar(505, 881, TEAL, '200 · blob:none · 505 ms');
    st.filter = 'blob:none';
    st.http = 200;
    await link(blobPkt, blobBar.bar, TEAL);
    await this.wait(0.4);

    // ---- pack ----------------------------------------------------------------
    await this.step('pack', { caption: 'parsePack records each object offset as the bytes arrive.', file: 'src/packresolve.js', line: 38 });
    await clearGraphic();
    const offTok = await swapCode(
      'src/packresolve.js', 38,
      '    const offset = p;',
      'offset', BLUE,
    );
    const barW = 14.6;
    const x0 = -7.3;
    const packY = 4.6;
    const segs: Rectangle[] = [];
    const fulls: Rectangle[] = [];
    for (const [off, len, fill] of PACK) {
      const w = Math.max(0.06, (len / PACK_BYTES) * barW);
      const rect = new Rectangle({ width: w, height: 1.15, fill, fillOpacity: 0.94, stroke: 'none' });
      rect.moveTo([x0 + (off / PACK_BYTES) * barW, packY], LEFT);
      const thin = rect.copy();
      thin.stretch(0.05 / w, 0, { aboutEdge: LEFT });
      segs.push(thin);
      fulls.push(rect);
    }
    graphic.add(...segs);
    await this.play(new LaggedStart(segs.map((s) => new FadeIn(s)), { lagRatio: 0.05 }), { runTime: 0.35 });
    await this.play(new LaggedStart(segs.map((s, i) => new Transform(s, fulls[i]!)), { lagRatio: 0.07 }), { runTime: 2.0, rateFunc: linear });
    const markSrc = ['930 B · 9 objects', '@12 · 371 B · commit', '@383 · 183 B · ref-delta', '@566 · 108 B · tree'];
    const markFs = Math.min(...markSrc.map((t) => fitSize(t, 14.4, 0.78)));
    const marks = column(markSrc.map((text, i) => ({ text, color: i === 0 ? DIM : i === 1 ? BLUE : i === 2 ? RED : GREEN, fs: markFs })), x0, 0);
    marks.shift([0, (packY - 0.85) - marks.top()[1]]);
    graphic.add(marks);
    const markLabels = marks.children.slice() as Text[];
    await this.play(new FadeIn(marks), { runTime: 0.35 });
    st.pack = '930 B @12 371 @383 183 @566 108';
    await link(offTok, segs[1]!, BLUE);
    await this.wait(0.4);

    // ---- delta ---------------------------------------------------------------
    await this.step('delta', { caption: 'The ref-delta names its base. applyDelta makes a commit.', file: 'src/packresolve.js', line: 51 });
    await clearLinks();
    const baseTok = await swapCode(
      'src/packresolve.js', 51,
      '      baseOid = toHex(buf.subarray(p, p + 20)); p += 20;',
      'baseOid', RED,
    );
    const baseTop = segs[2]!.top();
    const commitTop = segs[1]!.top();
    const arc = new CurvedArrow([baseTop[0], baseTop[1] + 0.28], [commitTop[0], commitTop[1] + 0.28], {
      angle: Math.PI / 5, stroke: RED, strokeWidth: 0.05, tipLength: 0.22, tipWidth: 0.16,
    });
    graphic.add(arc);
    await this.play(new Create(arc), { runTime: 0.8 });
    await link(baseTok, segs[2]!, RED, 'side');
    const applyTok = await swapCode(
      'src/packresolve.js', 154,
      '      const { out, ops } = applyDelta(base.data, obj.data, { maxResult: limits.maxDeltaResult });',
      'applyDelta', BLUE,
    );
    const resolved = mono('commit', markFs, BLUE, 'start');
    resolved.moveTo(markLabels[2]!, LEFT);
    await this.play(segs[2]!.animate.setFill(BLUE), new Transform(markLabels[2]!, resolved), { runTime: 0.7 });
    st.delta = '@383 -> @12 chain 1';
    await link(applyTok, segs[2]!, BLUE, 'side');
    await this.wait(0.4);

    // ---- trace ---------------------------------------------------------------
    await this.step('trace', { caption: 'The measured calls, after discover. 438, then 443, then 505.', file: 'src/otel.js', line: 48 });
    await clearGraphic();
    const spanTok = await swapCode(
      'src/otel.js', 48,
      '  async span(name, opts, fn) {',
      'span', GOLD,
    );
    const pillSrc = '3 upstream calls · 1.4 s · 1 retry';
    const pill = mono(pillSrc, fitSize(pillSrc, 14.4, 0.9), GOLD);
    pill.moveTo([0, 2.6]);
    graphic.add(pill);
    await this.play(new FadeIn(pill), { runTime: 0.35 });
    await link(spanTok, pill, GOLD, 'facing');
    await link(pill, blobBar.bar, TEAL, 'facing');
    await this.wait(0.45);

    // ---- pipeline ------------------------------------------------------------
    await this.step('pipeline', { caption: 'Fresh quirks, so this request still shows the retry.', file: 'worker/viewer/session.ts', line: 302 });
    await clearGraphic();
    const endTok = await swapCode(
      'worker/viewer/session.ts', 302,
      '  const quirks: Quirks = {};',
      'quirks', WHITE,
    );
    const stages: Array<[string, string]> = [
      ['github.com', TEAL],
      ['strip', ORANGE],
      ['ls-refs', TEAL],
      ['400', RED],
      ['200', TEAL],
      ['@12', BLUE],
      ['1.4 s', GOLD],
    ];
    const stageChips = stages.map(([label, color]) => chip(label, color, 0.72));
    let sy = 6.4;
    for (const c of stageChips) { c.moveTo([0, sy]); sy -= c.height() + 0.62; }
    graphic.add(...stageChips);
    await this.play(new LaggedStart(stageChips.map((c) => new FadeIn(c)), { lagRatio: 0.08 }), { runTime: 0.9 });
    const arrows: Arrow[] = [];
    for (let i = 0; i < stageChips.length - 1; i++) {
      arrows.push(new Arrow(stageChips[i]!.bottom(), stageChips[i + 1]!.top(), {
        buff: 0.08, stroke: DIM, strokeWidth: 0.035, tipLength: 0.16, tipWidth: 0.12,
      }));
    }
    graphic.add(...arrows);
    await this.play(new LaggedStart(arrows.map((a) => new Create(a)), { lagRatio: 0.08 }), { runTime: 0.8 });
    await link(endTok, stageChips[3]!, RED);
    await this.wait(0.45);
  }
}
