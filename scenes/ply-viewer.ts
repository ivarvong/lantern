// ply /view, as one mechanism: code, the picture it drives, and the values.
//
// The public viewer is moving from ivarvong/ply to ivarvong/ply-web. ply-web has
// no commits yet, so every quoted line is from ivarvong/ply pull/2 at
// 3f07a75c667ab8afad9e91d396836eb21abb1b8f. The page stays
// ply.ivar.workers.dev/view.
//
// One 16:9 frame, stacked the way a phone has to show it: the source line on
// top, the picture under it, the measured values along the bottom. The same
// frame is the desktop frame, so a connector drawn here is the connector on a
// 390px screen. A token leaves the source, becomes the thing it produces, and
// a line stays behind it. Colors are the concept, on every pane:
//   host / ls-refs / blob:none retry = teal,  tree / tree:0 = green,
//   commit / offset = blue,  ref-delta = red,  credential = orange,
//   blob bytes = grey,  pkt length / span = gold,  HTTP 400 = red.
import {
  Scene, Group, Text, Rectangle, Line, Arrow, CurvedArrow, Labeled, FadeIn, FadeOut, Create, Transform, LaggedStart,
  linear, LEFT, RIGHT, UP, DOWN,
  BLUE, TEAL, GREEN, RED, GREY, WHITE, ORANGE, GOLD,
} from '../src/index.ts';
import type { Mobject } from '../src/index.ts';

const INK = '#d8d8d8';
const DIM = '#8d8d8d';
const CODE_Y = 3.2;
const CITE_Y = 4.2;
const FS = 0.5;
// Dimmed context sits at or under the ghost-check floor (partial opacity is
// only a smear when two texts share a box). 0.1 is focus, not a crossfade.
const FADE = 0.1;

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

function buildLine(source: string, token: string, color: string): { group: Group; token: Text } {
  const i = source.indexOf(token);
  if (i < 0) throw new Error(`missing token ${JSON.stringify(token)} in ${JSON.stringify(source)}`);
  const parts: Text[] = [];
  if (i > 0) parts.push(mono(source.slice(0, i), FS, DIM, 'start'));
  const tok = mono(token, FS, color, 'start');
  parts.push(tok);
  if (i + token.length < source.length) parts.push(mono(source.slice(i + token.length), FS, DIM, 'start'));
  let x = 0;
  for (const p of parts) {
    p.moveTo([x, 0], LEFT);
    x += p.advance();
  }
  const group = new Group(...parts).moveTo([0, CODE_Y]);
  // A phone shows ~30 of these glyphs. Keep the active token on screen.
  if (group.width() > 15.2) group.shift([-tok.center()[0], 0]);
  return { group, token: tok };
}

function cite(file: string, line: number): Text {
  return mono(`${file}:${line}`, 0.4, DIM, 'start').moveTo([-7.6, CITE_Y], LEFT);
}

/** A straight connector that stops short of both ends. */
function join(a: Mobject, b: Mobject, color: string): Line {
  const ac = a.center(), bc = b.center();
  const down = ac[1] >= bc[1];
  const p = down ? a.bottom() : a.top();
  const q = down ? b.top() : b.bottom();
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return new Line(
    [p[0] + ux * 0.14, p[1] + uy * 0.14],
    [q[0] - ux * 0.12, q[1] - uy * 0.12],
    { stroke: color, strokeWidth: 0.04 },
  );
}

function chip(label: string, color: string, fontSize = 0.4): Labeled<Rectangle, Text> {
  const t = mono(label, fontSize, WHITE);
  const r = new Rectangle({
    width: t.advance() + 0.5, height: t.height() + 0.34, cornerRadius: 0.1,
    stroke: color, strokeWidth: 0.045, fill: color, fillOpacity: 0.16,
  });
  return new Labeled(r, t);
}

/** How long a move of `distance` scene units can take without a one-frame spike. */
function glide(distance: number): number {
  // Peak frame step stays under the verifier's 0.2 jump: smooth's peak is 1.875×
  // the average, at 30 fps. The cap covers a header flying the full frame.
  return Math.min(2.05, Math.max(0.55, distance * 0.42));
}

export class PlyViewerScene extends Scene {
  override async construct(): Promise<void> {
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
    const links: Line[] = [];

    const clearLinks = async (): Promise<void> => {
      if (!links.length) return;
      const gone = links.splice(0);
      await this.play(...gone.map((l) => new FadeOut(l)), { runTime: 0.25 });
    };
    const link = async (from: Mobject, to: Mobject, color: string): Promise<Line> => {
      const line = join(from, to, color);
      links.push(line);
      await this.play(new Create(line), { runTime: 0.4 });
      return line;
    };
    const swapCode = async (file: string, line: number, source: string, token: string, color: string): Promise<Text> => {
      await clearLinks();
      const next = buildLine(source, token, color);
      const nextCite = cite(file, line);
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
    // The active token leaves the source line and becomes `arrived`.
    // A copy fades back into the hole only after the original has gone,
    // so the two never share a box at partial opacity.
    const depart = async (token: Text, to: Readonly<[number, number]>, opts: { text?: string; color?: string; runTime?: number } = {}): Promise<{ flown: Text; home: Text }> => {
      const parent = token.parent;
      const home = token.copy();
      const target = token.copy();
      if (opts.text) target.setText(opts.text);
      if (opts.color) target.setFill(opts.color);
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
    const dim = async (mobs: Mobject[]): Promise<void> => {
      if (!mobs.length) return;
      await this.play(...mobs.map((m) => m.animate.setOpacity(FADE)), { runTime: 0.3 });
    };

    // Waterfall geometry. Bars are serial: 438, then 443, then 505.
    const total = 1386;
    const bx0 = -7.25;
    const bScale = 10.6 / total;
    const barY = [-2.35, -3.15, -3.95];
    const barH = 0.62;
    const barGroups: Group[] = [];
    const clock = mono('   0 ms', 0.46, WHITE, 'end').moveTo([7.35, -1.45], RIGHT);
    let clockOn = false;
    const growBar = async (i: number, ms: number, start: number, color: string, name: string): Promise<{ group: Group; bar: Rectangle }> => {
      if (barGroups.length) await dim(barGroups);
      if (!clockOn) {
        data.add(clock);
        clockOn = true;
        await this.play(new FadeIn(clock), { runTime: 0.2 });
      }
      const w = ms * bScale;
      const y = barY[i]!;
      const full = new Rectangle({ width: w, height: barH, fill: color, fillOpacity: 0.92, stroke: 'none' });
      full.moveTo([bx0 + start * bScale, y], LEFT);
      const bar = full.copy();
      bar.stretch(0.06 / w, 0, { aboutEdge: LEFT });
      const g = new Group(bar);
      data.add(g);
      barGroups.push(g);
      await this.play(new FadeIn(bar), { runTime: 0.18 });
      const shown = start + ms;
      const nextClock = mono(String(shown).padStart(4, ' ') + ' ms', 0.46, WHITE, 'end').moveTo(clock);
      await this.play(new Transform(bar, full), new Transform(clock, nextClock), { runTime: 0.85 + ms / 1600, rateFunc: linear });
      const label = mono(name, 0.36, WHITE, 'start');
      label.moveTo([bar.left()[0] + 0.16, y], LEFT);
      const msText = mono(`${ms} ms`, 0.4, color, 'start').moveTo([5.2, y], LEFT);
      g.add(label, msText);
      await this.play(new FadeIn(label), new FadeIn(msText), { runTime: 0.25 });
      st.clockMs = shown;
      return { group: g, bar };
    };

    // ---- url: owner/repo becomes the /view path, token by token ------------
    await this.step('url', { caption: 'owner/repo means GitHub. The paste becomes the path.', file: 'worker/viewer/paste.ts', line: 34 });
    const urlTok = await swapCode(
      'worker/viewer/paste.ts', 34,
      '  if (OWNER_REPO.test(text)) return { remote: `https://github.com/${text}` };',
      'github.com', TEAL,
    );
    const piece = (s: string, color: string) => mono(s, FS, color);
    const view = piece('/view/', GOLD);
    const slash0 = piece('/', INK);
    const octo = piece('octocat', INK);
    const slash = piece('/', INK);
    const hello = piece('Hello-World', INK);
    const hostSlot = piece('github.com', TEAL); // measures the hole; never drawn
    const lay = (parts: Text[], y: number): void => {
      const gap = 0.05;
      const w = parts.reduce((s, p) => s + p.advance(), 0) + gap * (parts.length - 1);
      let x = -w / 2;
      for (const p of parts) { p.moveTo([x, y], LEFT); x += p.advance() + gap; }
    };
    const shown = [octo, slash, hello];
    lay(shown, 0.7);
    graphic.add(...shown);
    await this.play(new LaggedStart(shown.map((t) => new FadeIn(t)), { lagRatio: 0.35 }), { runTime: 0.8 });
    const finalParts = [view, hostSlot, slash0, octo, slash, hello];
    const start = shown.map((t) => t.center().slice() as [number, number]);
    lay(finalParts, 0.7);
    const end = new Map(shown.map((t) => [t, t.center().slice() as [number, number]]));
    const hostAt = hostSlot.center().slice() as [number, number];
    shown.forEach((t, i) => t.moveTo(start[i]!));
    await this.play(...shown.map((t) => t.animate.moveTo(end.get(t)!)), { runTime: 0.7 });
    const { flown: hostTok, home: hostHome } = await depart(urlTok, hostAt, { color: TEAL });
    for (const t of [view, slash0]) t.setOpacity(0);
    graphic.add(view, slash0);
    await this.play(view.animate.setOpacity(1), slash0.animate.setOpacity(1), { runTime: 0.4 });
    st.url = '/view/github.com/octocat/Hello-World';
    await link(hostHome, hostTok, TEAL);
    await this.wait(0.45);

    // ---- allow: that host token lands on the one exact match ---------------
    await this.step('allow', { caption: 'Exact match only. A trailing dot is a different host.', file: 'worker/viewer/url.ts', line: 79 });
    await clearLinks();
    const allowTok = await swapCode(
      'worker/viewer/url.ts', 79,
      '  for (const item of allowed) if (item === host) return true;',
      'item === host', TEAL,
    );
    await this.play(...[view, slash0, octo, slash, hello].map((t) => t.animate.shift([0, 0.85])), { runTime: 0.5 });
    const names = ['gitlab.com', 'codeberg.org', 'bitbucket.org', 'git.sr.ht'] as const;
    const others = names.map((n) => chip(n, DIM, 0.38));
    const scaled = hostTok.advance() * 0.7;
    const ghBox = new Rectangle({
      width: scaled + 0.5, height: hostTok.height() * 0.7 + 0.34, cornerRadius: 0.1,
      stroke: DIM, strokeWidth: 0.045, fill: DIM, fillOpacity: 0.08,
    });
    const placeRow = (items: Mobject[], y: number): void => {
      const gap = 0.26;
      const w = items.reduce((s, m) => s + m.width(), 0) + gap * (items.length - 1);
      let x = -w / 2;
      for (const m of items) { m.moveTo([x, y], LEFT); x += m.width() + gap; }
    };
    placeRow([ghBox, others[0]!, others[1]!], -0.35);
    placeRow([others[2]!, others[3]!], -1.55);
    graphic.add(ghBox, ...others);
    await this.play(new LaggedStart([ghBox, ...others].map((m) => new FadeIn(m)), { lagRatio: 0.12 }), { runTime: 0.8 });
    const dHost = Math.hypot(ghBox.center()[0] - hostTok.center()[0], ghBox.center()[1] - hostTok.center()[1]);
    await this.play(hostTok.animate.moveTo(ghBox).scale(0.7), { runTime: glide(dHost) });
    await this.play(ghBox.animate.setStyle({ stroke: TEAL, fill: TEAL, fillOpacity: 0.28 }), { runTime: 0.35 });
    st.host = 'github.com';
    await link(allowTok, hostTok, TEAL);
    const readout = mono('host  github.com', 0.46, TEAL).moveTo([0, -2.7]);
    graphic.add(readout);
    await this.play(new FadeIn(readout), { runTime: 0.3 });
    await link(hostTok, readout, TEAL);
    const bad = mono('github.com.', 0.42, RED).moveTo([6.2, -2.7]);
    graphic.add(bad);
    await this.play(new FadeIn(bad), { runTime: 0.3 });
    await this.play(bad.animate.moveTo([5.4, -1.55]), { runTime: 0.6 });
    await this.play(new FadeOut(bad), { runTime: 0.35 });
    await this.wait(0.3);

    // ---- strip: credential headers leave before the request does -----------
    await this.step('strip', { caption: 'Only four headers survive. User-Agent is forced.', file: 'worker/viewer/fetchguard.ts', line: 18 });
    await clearGraphic();
    const stripTok = await swapCode(
      'worker/viewer/fetchguard.ts', 18,
      '    if (ALLOWED.has(key.toLowerCase())) out.set(key, value);',
      'ALLOWED.has', ORANGE,
    );
    const forbidden = ['Authorization', 'Git-Token', 'Cookie', 'Git-Authorization'];
    const keptNames = ['accept', 'git-protocol'];
    const forb = forbidden.map((h) => mono(h, 0.46, ORANGE));
    const kept = keptNames.map((h) => mono(h, 0.46, TEAL));
    const headers = [...forb, ...kept];
    headers.forEach((h, i) => h.moveTo([-1.2, 1.7 - i * 0.58], LEFT));
    const card = new Rectangle({
      width: 5.4, height: headers.length * 0.58 + 0.35, cornerRadius: 0.12,
      stroke: ORANGE, strokeWidth: 0.04, fill: ORANGE, fillOpacity: 0.05,
    });
    card.moveTo([-1.2 + 2.3, (headers[0]!.center()[1] + headers[headers.length - 1]!.center()[1]) / 2]);
    graphic.add(card, ...headers);
    await this.play(new FadeIn(card), new LaggedStart(headers.map((h) => new FadeIn(h)), { lagRatio: 0.1 }), { runTime: 0.7 });
    await link(stripTok, forb[0]!, ORANGE);
    const dropped: Text[] = [];
    for (const [i, h] of forb.entries()) {
      await clearLinks();
      const dest: [number, number] = [-6.2 + i * 3.3, -3.45];
      const d = Math.hypot(dest[0] - h.center()[0], dest[1] - h.center()[1]);
      await this.play(h.animate.moveTo(dest).scale(0.78), { runTime: glide(d) });
      dropped.push(h);
    }
    st.dropped = forbidden.join(' ');
    await link(stripTok, dropped[0]!, ORANGE);
    const uaTok = await swapCode(
      'worker/viewer/fetchguard.ts', 20,
      "  out.set('user-agent', VIEWER_UA);",
      'VIEWER_UA', GOLD,
    );
    const ua = mono('user-agent  ply-viewer/0.1.0', 0.44, GOLD).moveTo([0.4, -2.15]);
    graphic.add(ua);
    await this.play(new FadeIn(ua), { runTime: 0.35 });
    await link(uaTok, ua, GOLD);
    await this.wait(0.35);

    // ---- refs: the real ls-refs body, then its 438 ms bar -------------------
    await this.step('refs', { caption: 'listRefs asks for HEAD and refs/heads/.', file: 'worker/viewer/session.ts', line: 185 });
    await clearGraphic();
    const refTok = await swapCode(
      'worker/viewer/session.ts', 185,
      '  const listedRefs = await listRefs(transport, refPrefixes(route.ref));',
      'refPrefixes', TEAL,
    );
    // lsRefsBody defaults peel and symrefs on, and delimits after the command.
    // refPrefixes(null) is HEAD then refs/heads/. Lengths are pkt()’s.
    const refLines: Array<{ payload: string; color: string }> = [
      { payload: 'command=ls-refs\n', color: INK },
      { payload: '', color: GOLD }, // 0001, the delim after the command
      { payload: 'peel\n', color: DIM },
      { payload: 'symrefs\n', color: DIM },
      { payload: 'ref-prefix HEAD\n', color: TEAL },
      { payload: 'ref-prefix refs/heads/\n', color: TEAL },
      { payload: '', color: GOLD }, // 0000 flush
    ];
    // Four lines fit under the source without touching. The command stays put;
    // delim, peel and symrefs scroll off, then the prefixes and the flush.
    const SLOT = 0.82;
    const TOP = 1.55;
    const fsPkt = 0.44;
    const shownPkts: Group[] = [];
    let headsPkt: Group | null = null;
    const pktGroup = (payload: string, color: string, hexOverride?: string): Group => {
      const framed = payload ? pktLine(payload) : { hex: hexOverride!, body: '' };
      const hex = mono(framed.hex, fsPkt, GOLD, 'start');
      const body = framed.body ? mono(framed.body, fsPkt, color, 'start') : null;
      const w = hex.advance() + (body ? 0.12 + body.advance() : 0);
      hex.moveTo([-w / 2, 0], LEFT);
      if (body) body.nextTo(hex, RIGHT, 0.12);
      return new Group(hex, ...(body ? [body] : []));
    };
    for (let i = 0; i < refLines.length; i++) {
      const spec = refLines[i]!;
      if (shownPkts.length === 4) {
        // Drop the oldest line that is not the command, then close the gap.
        const dropAt = shownPkts.length > 1 ? 1 : 0;
        const drop = shownPkts.splice(dropAt, 1)[0]!;
        await this.play(new FadeOut(drop), { runTime: 0.18 });
        await this.play(...shownPkts.map((g, k) => g.animate.moveTo([0, TOP - k * SLOT])), { runTime: 0.32 });
      }
      const g = pktGroup(spec.payload, spec.color, i === 1 ? '0001' : '0000');
      g.moveTo([0, TOP - shownPkts.length * SLOT]);
      graphic.add(g);
      shownPkts.push(g);
      if (spec.payload.startsWith('ref-prefix refs/heads/')) headsPkt = g;
      await this.play(new FadeIn(g), { runTime: 0.24 });
    }
    // Lift the heads line out of the stack so the connector meets it, and park
    // the other lines to the right, clear of that line.
    const context = shownPkts.filter((g) => g !== headsPkt);
    await this.play(
      headsPkt!.animate.moveTo([-2.2, 1.2]),
      ...context.map((g, i) => g.animate.moveTo([4.1, 0.35 - i * 0.75])),
      { runTime: 1.6 },
    );
    const also = mono('0001  ·  0009peel  ·  000csymrefs', 0.34, DIM).moveTo([-2.4, -1.55]);
    graphic.add(also);
    await this.play(new FadeIn(also), { runTime: 0.25 });
    st.pkt = '0014command=ls-refs 0001 0009peel 000csymrefs 0014ref-prefix HEAD 001bref-prefix refs/heads/ 0000';
    await link(refTok, headsPkt!, TEAL);
    const refsBar = await growBar(0, 438, 0, TEAL, 'ls-refs');
    await link(headsPkt!, refsBar.bar, TEAL);
    await this.wait(0.25);

    // ---- fetch: tree:0 leaves the source, hits the wall, lands on 400 ------
    await this.step('fetch', { caption: 'The commit fetch asks for filter tree:0.', file: 'worker/viewer/session.ts', line: 187 });
    await clearGraphic();
    const fetchTok = await swapCode(
      'worker/viewer/session.ts', 187,
      "  const commitObj = await readObject(transport, { oid: resolved.commit, filter: 'tree:0', deepen: 1, expectType: TYPE.COMMIT });",
      "filter: 'tree:0'", GREEN,
    );
    const treePktText = pktLine('filter tree:0\n');
    const { flown: treePkt, home: treeHome } = await depart(fetchTok, [-2.4, 1.15], {
      text: treePktText.hex + treePktText.body, color: GREEN, runTime: 1.15,
    });
    await link(treeHome, treePkt, GREEN);
    const wall = new Rectangle({ width: 0.16, height: 1.7, fill: RED, stroke: 'none', fillOpacity: 0.95 }).moveTo([3.15, 1.15]);
    graphic.add(wall);
    await this.play(new FadeIn(wall), { runTime: 0.25 });
    await this.play(treePkt.animate.moveTo([1.7, 1.15]), { runTime: 0.7 });
    const http400 = mono('400', 0.52, RED).moveTo([4.7, 1.15]);
    graphic.add(http400);
    await this.play(treePkt.animate.moveTo([-0.4, 1.15]), new FadeIn(http400), { runTime: 0.45 });
    const treeBar = await growBar(1, 443, 438, GREEN, 'tree:0');
    const statusAt: [number, number] = [4.2, barY[1]!];
    await this.play(http400.animate.moveTo(statusAt).scale(0.85), { runTime: 0.7 });
    treeBar.group.add(http400);
    st.filter = 'tree:0';
    st.http = 400;
    await link(treePkt, http400, RED);
    await this.wait(0.3);

    // ---- retry: blob:none crosses, and the bar is 200 / 505 ms -------------
    await this.step('retry', { caption: 'That answer is the rejection. The retry is blob:none.', file: 'src/fetch.js', line: 176 });
    await clearLinks();
    await this.play(new FadeOut(treePkt), { runTime: 0.25 });
    const retryTok = await swapCode(
      'src/fetch.js', 176,
      "    if (t.quirks) t.quirks.treeFilter = 'blob:none';",
      'blob:none', TEAL,
    );
    const blobPktText = pktLine('filter blob:none\n');
    const { flown: blobPkt, home: blobHome } = await depart(retryTok, [-1.6, 1.15], {
      text: blobPktText.hex + blobPktText.body, color: TEAL, runTime: 1.05,
    });
    await link(blobHome, blobPkt, TEAL);
    await this.play(blobPkt.animate.moveTo([1.7, 1.15]), { runTime: 0.85 });
    const http200 = mono('200', 0.52, TEAL).moveTo([6.35, 1.15]);
    graphic.add(http200);
    await this.play(new FadeIn(http200), { runTime: 0.3 });
    const blobBar = await growBar(2, 505, 881, TEAL, 'blob:none');
    await this.play(http200.animate.moveTo([4.2, barY[2]!] as [number, number]).scale(0.85), { runTime: 0.75 });
    blobBar.group.add(http200);
    st.filter = 'blob:none';
    st.http = 200;
    await link(blobPkt, http200, TEAL);
    await this.wait(0.25);

    // ---- pack: offset in the parse loop, then the segment it names ---------
    await this.step('pack', { caption: 'parsePack records each object offset as the bytes arrive.', file: 'src/packresolve.js', line: 38 });
    await clearGraphic();
    await dim([...barGroups, clock]);
    const offTok = await swapCode(
      'src/packresolve.js', 38,
      '    const offset = p;',
      'offset', BLUE,
    );
    const barW = 14.4;
    const x0 = -7.2;
    const packY = 1.05;
    const segs: Rectangle[] = [];
    const fulls: Rectangle[] = [];
    for (const [off, len, fill] of PACK) {
      const w = Math.max(0.05, (len / PACK_BYTES) * barW);
      const rect = new Rectangle({ width: w, height: 0.85, fill, fillOpacity: 0.94, stroke: 'none' });
      rect.moveTo([x0 + (off / PACK_BYTES) * barW, packY], LEFT);
      const thin = rect.copy();
      thin.stretch(0.045 / w, 0, { aboutEdge: LEFT });
      segs.push(thin);
      fulls.push(rect);
    }
    graphic.add(...segs);
    await this.play(new LaggedStart(segs.map((s) => new FadeIn(s)), { lagRatio: 0.05 }), { runTime: 0.35 });
    await this.play(new LaggedStart(segs.map((s, i) => new Transform(s, fulls[i]!)), { lagRatio: 0.07 }), { runTime: 2.2, rateFunc: linear });
    const marks: Array<[number, string, string]> = [
      [1, '@12   371 B', BLUE],
      [2, '@383  183 B', RED],
      [3, '@566  108 B', GREEN],
    ];
    const markText: Text[] = [];
    // Side by side under the bar. nextTo each segment would pile @383 onto @566.
    const markY = -0.15;
    const markX = [-5.1, -0.4, 4.3];
    for (const [n, [index, text, color]] of marks.entries()) {
      const t = mono(text, 0.38, color);
      t.moveTo([markX[n]!, markY]);
      graphic.add(t);
      markText.push(t);
      await this.play(new FadeIn(t), { runTime: 0.2 });
      await link(t, segs[index]!, color);
    }
    const legend = mono('930 B · 9 objects · header commit tree blob tag ofs-delta ref-delta trailer', 0.32, DIM);
    legend.moveTo([0, -0.85]);
    graphic.add(legend);
    await this.play(new FadeIn(legend), { runTime: 0.3 });
    st.pack = '930 B @12 371 @383 183 @566 108';
    await link(offTok, segs[1]!, BLUE);
    await this.wait(0.25);

    // ---- delta: the ref-delta points at its base, then applyDelta resolves it
    await this.step('delta', { caption: 'The ref-delta names its base. applyDelta makes a commit.', file: 'src/packresolve.js', line: 51 });
    await clearLinks();
    await dim([legend, markText[2]!, ...segs.filter((_, i) => i !== 1 && i !== 2)]);
    const baseTok = await swapCode(
      'src/packresolve.js', 51,
      '      baseOid = toHex(buf.subarray(p, p + 20)); p += 20;',
      'baseOid', RED,
    );
    const arc = new CurvedArrow(segs[2]!.top(), segs[1]!.top(), {
      angle: -Math.PI / 3, stroke: RED, strokeWidth: 0.045, tipLength: 0.22, tipWidth: 0.16,
    });
    graphic.add(arc);
    await this.play(new Create(arc), { runTime: 0.8 });
    await link(baseTok, segs[2]!, RED);
    const applyTok = await swapCode(
      'src/packresolve.js', 154,
      '      const { out, ops } = applyDelta(base.data, obj.data, { maxResult: limits.maxDeltaResult });',
      'applyDelta', BLUE,
    );
    const resolved = mono('commit', 0.38, BLUE).moveTo(markText[1]!);
    await this.play(segs[2]!.animate.setFill(BLUE), new Transform(markText[1]!, resolved), { runTime: 0.7 });
    st.delta = '@383 -> @12 chain 1';
    await link(applyTok, segs[2]!, BLUE);
    await this.wait(0.35);

    // ---- trace: span() is the clock the three bars already grew on ---------
    await this.step('trace', { caption: 'The measured calls, after discover. 438, then 443, then 505.', file: 'src/otel.js', line: 48 });
    await clearGraphic();
    await this.play(...[...barGroups, clock].map((m) => m.animate.setOpacity(1)), { runTime: 0.4 });
    const spanTok = await swapCode(
      'src/otel.js', 48,
      '  async span(name, opts, fn) {',
      'span', GOLD,
    );
    await link(spanTok, refsBar.bar, TEAL);
    await link(spanTok, treeBar.bar, GREEN);
    await link(spanTok, blobBar.bar, TEAL);
    const pill = mono('3 upstream calls · 1.4 s · 1 retry', 0.42, GOLD).moveTo([0, 1.15]);
    graphic.add(pill);
    await this.play(new FadeIn(pill), { runTime: 0.35 });
    await link(spanTok, pill, GOLD);
    await this.wait(0.4);

    // ---- the whole read, pulled back ---------------------------------------
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
    const stageChips = stages.map(([label, color]) => chip(label, color, 0.38));
    const gap = 0.22;
    const rowW = stageChips.reduce((s, c) => s + c.width(), 0) + gap * (stageChips.length - 1);
    let x = -rowW / 2;
    for (const c of stageChips) { c.moveTo([x, 0.85], LEFT); x += c.width() + gap; }
    graphic.add(...stageChips);
    await this.play(new LaggedStart(stageChips.map((c) => new FadeIn(c)), { lagRatio: 0.1 }), { runTime: 0.9 });
    const arrows: Arrow[] = [];
    for (let i = 0; i < stageChips.length - 1; i++) {
      arrows.push(new Arrow(stageChips[i]!.right(), stageChips[i + 1]!.left(), {
        buff: 0.06, stroke: DIM, strokeWidth: 0.03, tipLength: 0.14, tipWidth: 0.1,
      }));
    }
    graphic.add(...arrows);
    await this.play(new LaggedStart(arrows.map((a) => new Create(a)), { lagRatio: 0.1 }), { runTime: 0.9 });
    await link(endTok, stageChips[3]!, RED);
    await this.wait(0.8);
  }
}
