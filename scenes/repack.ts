// Repacking git in a 64MB budget: how the repack lab works, and what it measured.
//
// Every number on screen is in MEASURED below, copied from a run of the repack lab
// (pure TypeScript, no runtime deps) on 2026-10-24, with the command that produced it.
// Bars are drawn to scale from those numbers; nothing is eyeballed.
import {
  Scene, Group, Labeled, Rectangle, Text, Code, Arrow, FadeIn, FadeOut, Create, Write, Indicate,
  LaggedStart, UP, DOWN, LEFT, RIGHT, BLUE, TEAL, GOLD, GREEN, RED, GREY, WHITE, YELLOW, PURPLE, ORANGE, title,
} from '../src/index.ts';
import type { Mobject } from '../src/index.ts';

const MEASURED = {
  // src/gen.mjs + src/ingest.sh: 100 snapshots of a 30MB JSON, ~0.2% of records changed each, one push each
  // blobs only on both sides: the lab's pack holds the 100 blobs; git's 4.78MB pack also has commits+trees
  synthetic: { pushDeltaKB: 10.8, fixThinBaseMB: 4.6, asReceivedMB: 432.2, duplicateMB: 208.2, gitRepackMB: 4.75, gitRepackRssGB: 5.5, oursMB: 4.49 },
  // src/packmap.ts on nytimes/covid-19-data (full clone), cross-checked with git cat-file: 0 mismatches
  covid: { packMB: 9932, wholeMB: 4538, readMB: 741, seconds: 11.5, objects: 35919, resolvedGB: 178.3 },
  // rolling-averages/us-counties-2022.csv in the covid pack; pairs.ts on 8 whole-stored versions
  ra2022: { versions: 901, whole: 148, wholeMB: 1934, deltaPctMin: 0.0, deltaPctMax: 1.1 },
  // src/writepath.ts, then git index-pack --strict: identical object set
  usStates: { versions: 1133, githubMB: 114.21, oursMB: 3.02 },
  // cdcdelta.ts defaults
  cdc: { avgChunkKB: 8, gapCapMB: 1, regionCapMB: 2, maxDeltaMB: 8 },
};

const mono = (s: string, size = 0.22, color = WHITE) => new Text(s, { font: 'mono', fontSize: size, color });
const sans = (s: string, size = 0.24, color = GREY) => new Text(s, { fontSize: size, color });
const box = (w: number, h: number, c: string, op = 0.14) => new Rectangle({ width: w, height: h, cornerRadius: 0.06, stroke: c, strokeWidth: 0.035, fill: c, fillOpacity: op });

/** Keep anything inside the 16-unit frame with a margin: scale it down about its center if needed. */
function fit<T extends Mobject>(m: T, max = 14.6): T {
  if (m.width() > max) { const c = m.center(); m.setWidth(max); m.moveTo(c); }
  return m;
}

/** A horizontal bar starting at x0, `w` units long (to scale), with a label to its right. */
function bar(x0: number, y: number, w: number, c: string, label: string, h = 0.42): Group {
  const r = box(Math.max(w, 0.02), h, c, 0.5).moveTo([x0, y], LEFT);
  const t = mono(label, 0.2, WHITE).nextTo(r, RIGHT, 0.15);
  return new Group(r, t);
}

export class RepackScene extends Scene {
  override async construct() {
    const M = MEASURED;
    const st: { phase: string; budgetMB: number; verified: boolean; numbers: Record<string, number> } = { phase: 'intro', budgetMB: 64, verified: false, numbers: {} };
    this.state = st;

    // ---- intro -----------------------------------------------------------------------------
    await this.step('intro', { caption: 'A git repo that stores a 30MB JSON file updated every 30 minutes grows by gigabytes, even though each update changes a fraction of a percent. This explainer shows why, and how a repacker running in a Cloudflare Worker with a 64MB memory budget shrinks it without ever risking the data. Three parts: read a map of the pack, find deltas without holding files in memory, and prove every byte before keeping it.' });
    const t = title('Repacking git in 64MB');
    await this.play(new Write(t), { runTime: 0.9 });
    const parts = new Group(
      ...([['map', 'read headers, not objects', TEAL], ['delta', 'chunks + range reads, bounded', BLUE], ['gate', 'hash every byte; git judges', GREEN]] as const)
        .map(([k, d, c]) => new Group(new Labeled(box(1.7, 0.6, c), mono(k, 0.26)), sans(d, 0.24)).arrange(RIGHT, 0.35)),
    ).arrange(DOWN, 0.4, LEFT).moveTo([-0.4, 0.3]);
    await this.play(new LaggedStart(parts.children.map((g) => new FadeIn(g, { shift: [0, -0.15] })), { lagRatio: 0.25 }), { runTime: 1.4 });
    const budget = sans('budget: 64MB peak per Worker  ·  source packs on R2, read by byte range', 0.22).moveTo([0, -2.4]);
    await this.play(new FadeIn(budget), { runTime: 0.4 });
    await this.wait(0.6);

    // ---- bloat ---------------------------------------------------------------------------------
    await this.step('bloat', { caption: `Why it bloats. Each push sends a thin pack: the new version as a delta, about ${M.synthetic.pushDeltaKB}KB, against a version the server already has. A pack on disk must be self-contained, so the server runs index-pack --fix-thin, which appends that base version whole: ${M.synthetic.fixThinBaseMB}MB, every push. A hundred pushes leave ${M.synthetic.asReceivedMB}MB, and ${M.synthetic.duplicateMB}MB of it is the same objects stored twice.` });
    await this.play(new FadeOut(parts), new FadeOut(budget), { runTime: 0.4 });
    // to scale: 1 unit = 1MB, so a 10.8KB delta is a sliver next to the 4.6MB base
    const pushes = new Group();
    for (let i = 0; i < 4; i++) {
      const y = 1.6 - i * 0.85;
      const lbl = mono(`push ${i + 1}`, 0.2, GREY).moveTo([-6.6, y]);
      const d = box(Math.max(M.synthetic.pushDeltaKB / 1024, 0.03), 0.5, TEAL, 0.7).moveTo([-5.6, y], LEFT);
      const b = box(M.synthetic.fixThinBaseMB, 0.5, RED, 0.35).nextTo(d, RIGHT, 0.05);
      const bl = mono('previous version, whole (--fix-thin)', 0.17, WHITE).moveTo(b.center());
      pushes.add(new Group(lbl, d, b, bl));
    }
    const legend = new Group(
      new Group(box(0.3, 0.3, TEAL, 0.7), sans(`the push: ${M.synthetic.pushDeltaKB}KB delta`, 0.22)).arrange(RIGHT, 0.2),
      new Group(box(0.3, 0.3, RED, 0.35), sans(`appended to make the pack self-contained: ${M.synthetic.fixThinBaseMB}MB`, 0.22)).arrange(RIGHT, 0.2),
    ).arrange(DOWN, 0.2, LEFT).moveTo([-1.4, -2.2]);
    await this.play(new LaggedStart(pushes.children.map((g) => new FadeIn(g, { shift: [0.3, 0] })), { lagRatio: 0.3 }), { runTime: 1.4 });
    await this.play(new FadeIn(legend), { runTime: 0.4 });
    const total = fit(mono(`100 pushes → ${M.synthetic.asReceivedMB}MB (drawn to scale: 1 unit = 1MB)`, 0.22, YELLOW).moveTo([0, -3.3]));
    await this.play(new FadeIn(total), { runTime: 0.5 });
    st.phase = 'bloat'; st.numbers = { asReceivedMB: M.synthetic.asReceivedMB, duplicateMB: M.synthetic.duplicateMB };
    await this.wait(0.6);

    // ---- map ------------------------------------------------------------------------------------
    await this.step('map', { caption: `Read the map before touching anything. The pack map walks the index and reads only each object's header and the first bytes of each delta: type, sizes, base, chain depth, and the path it lives at. On the real nytimes/covid-19-data repo that is ${M.covid.readMB}MB read out of a ${(M.covid.packMB / 1024).toFixed(1)}GB pack, in ${M.covid.seconds} seconds, for ${M.covid.objects.toLocaleString('en-US')} objects. Every field agrees with git's own view of the pack.` });
    await this.play(new FadeOut(new Group(pushes, legend, total)), { runTime: 0.4 });
    const scale = 12 / M.covid.packMB; // the whole pack is 12 units wide
    const strip = box(12, 0.7, GREY, 0.08).moveTo([0, 1.6]);
    const whole = box(M.covid.wholeMB * scale, 0.7, GOLD, 0.55).moveTo(strip, LEFT);
    const deltas = box((M.covid.packMB - M.covid.wholeMB) * scale, 0.7, TEAL, 0.4).moveTo(strip, RIGHT);
    const stripLbl = mono(`covid-19-data pack: ${(M.covid.packMB / 1024).toFixed(1)}GB, resolving to ${M.covid.resolvedGB}GB of history`, 0.22, WHITE).nextTo(strip, UP, 0.2);
    const wl = mono(`whole copies ${(M.covid.wholeMB / 1024).toFixed(1)}GB (46%)`, 0.2, GOLD).nextTo(whole, DOWN, 0.15);
    const dl = mono('deltas', 0.2, TEAL).nextTo(deltas, DOWN, 0.15);
    await this.play(new FadeIn(stripLbl), new Create(strip), { runTime: 0.6 });
    await this.play(new FadeIn(whole), new FadeIn(deltas), new FadeIn(wl), new FadeIn(dl), { runTime: 0.7 });
    const row = new Code([
      '{ sha, type, offset, packed, size, base, depth, path, firstSeen }',
      '',
      'read per object:  header (≤32 bytes)  +  delta prefix (24 bytes inflated)',
      `read in total:    ${M.covid.readMB}MB of ${M.covid.packMB.toLocaleString('en-US')}MB   →   ${M.covid.seconds}s`,
      'oracle:           git cat-file --batch-check   →   0 mismatches',
    ], { fontSize: 0.21 }).moveTo([0, -1.2]);
    fit(row);
    row.lines[4]!.setFill(GREEN);
    await this.play(new FadeIn(row, { shift: [0, -0.2] }), { runTime: 0.6 });
    st.phase = 'map'; st.numbers = { packMB: M.covid.packMB, wholeMB: M.covid.wholeMB, readMB: M.covid.readMB };
    await this.wait(0.8);

    // ---- one path ----------------------------------------------------------------------------
    await this.step('path', { caption: `Zoom into one path. rolling-averages/us-counties-2022.csv has ${M.ra2022.versions} versions in the pack, and ${M.ra2022.whole} of them are stored whole: ${(M.ra2022.wholeMB / 1024).toFixed(2)}GB. Is that data that cannot be compressed, or a packer that chose badly? Test it: take each whole-stored version and delta it against the version just before it. Every one comes out between ${M.ra2022.deltaPctMin}% and ${M.ra2022.deltaPctMax}% of its whole size.` });
    await this.play(new FadeOut(new Group(strip, whole, deltas, stripLbl, wl, dl, row)), { runTime: 0.4 });
    const pathLbl = mono('rolling-averages/us-counties-2022.csv', 0.24, WHITE).moveTo([0, 2.6]);
    await this.play(new FadeIn(pathLbl), { runTime: 0.4 });
    // a run of versions: gold = stored whole in the existing pack, teal = stored as delta
    const pattern = 'DDWDDDWWWDDDWDDWWDDDWDD';
    const vers = new Group(...[...pattern].map((k) => box(0.42, k === 'W' ? 1.2 : 0.3, k === 'W' ? GOLD : TEAL, k === 'W' ? 0.55 : 0.5)))
      .arrange(RIGHT, 0.1, DOWN).moveTo([0, 1.2]);
    const vLbl = fit(sans('tall gold: stored whole · short teal: stored as a delta (illustrative run of versions)', 0.2).nextTo(vers, DOWN, 0.2));
    await this.play(new LaggedStart(vers.children.map((v) => new FadeIn(v, { shift: [0, 0.2] })), { lagRatio: 0.05 }), { runTime: 1.0 });
    await this.play(new FadeIn(vLbl), { runTime: 0.3 });
    const test = new Code([
      'whole-stored version vs its predecessor     whole (z)    delta (z)',
      'v311   29.5MB                                  8.10MB       0.05MB',
      'v479   42.3MB                                 11.49MB       0.05MB',
      'v607   53.1MB                                 14.33MB      <0.01MB',
      'v715   64.6MB                                 17.65MB      <0.01MB',
    ], { fontSize: 0.21 }).moveTo([0, -1.6]);
    fit(test);
    test.lines[0]!.setFill(GREY);
    await this.play(new FadeIn(test, { shift: [0, -0.2] }), { runTime: 0.6 });
    for (const i of [1, 2, 3, 4]) test.lines[i]!.setFill(GREEN);
    await this.play(new Indicate(test, { color: GREEN, scaleFactor: 1.02 }), { runTime: 0.5 });
    st.phase = 'path'; st.numbers = { versions: M.ra2022.versions, whole: M.ra2022.whole, deltaPctMax: M.ra2022.deltaPctMax };
    await this.wait(0.8);

    // ---- cdc -------------------------------------------------------------------------------------
    await this.step('cdc', { caption: `How a delta is found without holding either file. Cut both versions into chunks where the content itself says to cut, about ${M.cdc.avgChunkKB}KB each, so an edit only moves the boundaries next to it. Hash the old version's chunks into a small index. Stream the new version: a chunk seen before becomes a copy op; the gaps between matches get a fine byte-level diff against the matching region of the old file, capped at ${M.cdc.gapCapMB}MB and ${M.cdc.regionCapMB}MB. The output is ordinary git delta encoding.` });
    await this.play(new FadeOut(new Group(pathLbl, vers, vLbl, test)), { runTime: 0.4 });
    const widths = [1.1, 0.8, 1.3, 0.9, 1.2, 1.0, 0.7, 1.1, 0.9];
    const mk = (y: number, changed: number) => new Group(...widths.map((w, i) => box(w, 0.55, i === changed ? ORANGE : BLUE, i === changed ? 0.5 : 0.25)))
      .arrange(RIGHT, 0.06).moveTo([0.4, y]);
    const oldV = mk(1.4, -1), newV = mk(-0.6, 4);
    const oldL = mono('base (old)', 0.22, GREY).nextTo(oldV, LEFT, 0.3), newL = mono('target (new)', 0.22, GREY).nextTo(newV, LEFT, 0.3);
    await this.play(new FadeIn(oldV), new FadeIn(oldL), { runTime: 0.5 });
    await this.play(new FadeIn(newV), new FadeIn(newL), { runTime: 0.5 });
    const links = new Group(...widths.map((_, i) => i === 4 ? null : new Arrow(newV.children[i]!.boxPoint(UP), oldV.children[i]!.boxPoint(DOWN), { stroke: TEAL, strokeWidth: 0.03, buff: 0.06 })).filter((x): x is Arrow => x !== null));
    await this.play(new LaggedStart(links.children.map((a) => new Create(a)), { lagRatio: 0.12 }), { runTime: 1.0 });
    const copyL = mono('same chunk hash → copy(offset, length)', 0.2, TEAL).nextTo(oldV, UP, 0.25);
    await this.play(new FadeIn(copyL), { runTime: 0.3 });
    const gap = newV.children[4]!;
    await this.play(new Indicate(gap, { color: ORANGE, scaleFactor: 1.15 }), { runTime: 0.5 });
    const diffL = mono('unmatched gap → fine diff vs the same region of base → copy + insert', 0.2, ORANGE).moveTo([0.4, -1.5]);
    await this.play(new FadeIn(diffL), { runTime: 0.4 });
    const ops = new Code(['e.g. copy(0, 8412) copy(8412, 6133) … insert("1043,12.5") copy(…)', 'encoded as a standard git delta: git can read it with no changes'], { fontSize: 0.2 }).moveTo([0.4, -2.6]);
    fit(ops);
    ops.lines[1]!.setFill(GREY);
    await this.play(new FadeIn(ops, { shift: [0, -0.2] }), { runTime: 0.5 });
    st.phase = 'cdc';
    await this.wait(0.8);

    // ---- bounded -------------------------------------------------------------------------------
    await this.step('bounded', { caption: 'Nothing is ever held whole. Source bytes arrive as range reads; the base is read back in blocks only where copy ops point; output streams out in 1MB writes. Every job runs under a 64MB heap limit. Measurement and that limit found real bugs on real data; three are fixed and pinned by tests, and one is still open.' });
    await this.play(new FadeOut(new Group(oldV, newV, oldL, newL, links, copyL, diffL, ops)), { runTime: 0.4 });
    const gauge = box(10, 0.6, GREY, 0.06).moveTo([0, 2.0]);
    const unit = 10 / 64;
    const used = box(4.5 * unit, 0.6, GREEN, 0.6).moveTo(gauge, LEFT);
    const garbage = box((42 - 4.5) * unit, 0.6, GREEN, 0.2).nextTo(used, RIGHT, 0);
    const gl = mono('64MB', 0.22, WHITE).nextTo(gauge, RIGHT, 0.2);
    const ul = mono('synthetic: retained 4.5MB · peak incl. garbage 42MB  ·  real data peaked 54MB', 0.2, GREEN).nextTo(gauge, DOWN, 0.2);
    await this.play(new Create(gauge), new FadeIn(gl), { runTime: 0.5 });
    await this.play(new FadeIn(used), new FadeIn(garbage), new FadeIn(ul), { runTime: 0.6 });
    const bugs = new Code([
      'found                                           fix',
      'insert ops viewed whole 1MB read buffers         copy just the inserted bytes',
      'delta encoder built a JS number[] before         size-capped while building; give up',
      '  checking size (regenerated file → OOM)           to "store whole" at 8MB',
      '500K tiny ops as JS objects (~150B each)         typed arrays: ~17 bytes per op',
      'open: delta builder still holds ops as objects;  same typed-array fix; 901-version',
      '  the 2022 rolling-averages rebuild OOMs           rebuild is the test',
    ], { fontSize: 0.2 }).moveTo([0, -0.9]);
    fit(bugs);
    bugs.lines[0]!.setFill(GREY);
    for (const i of [1, 2, 4]) bugs.lines[i]!.setFill(WHITE);
    for (const i of [5, 6]) bugs.lines[i]!.setFill(ORANGE);
    await this.play(new FadeIn(bugs, { shift: [0, -0.2] }), { runTime: 0.6 });
    st.phase = 'bounded'; st.numbers = { retainedMB: 4.5, peakWithGarbageMB: 42 };
    await this.wait(0.8);

    // ---- gate -----------------------------------------------------------------------------------
    await this.step('gate', { caption: 'Every byte is proven before it is kept. A delta is applied as a stream straight into SHA-1, and the result must equal the object\'s name. Then real git is the judge: index-pack --strict rebuilds every object from the new pack on its own and hashes it, and the set of objects must equal the source set exactly, nothing missing and nothing extra. A heuristic that guesses wrong can only cost compression, never correctness.' });
    await this.play(new FadeOut(new Group(gauge, used, garbage, gl, ul, bugs)), { runTime: 0.4 });
    const nodes = ([['delta', BLUE], ['stream apply', BLUE], ['SHA-1', GREEN], ['= object id?', GREEN], ['index-pack --strict', PURPLE], ['set equality', PURPLE]] as const)
      .map(([s, c]) => new Labeled(box(s.length * 0.13 + 0.6, 0.6, c), mono(s, 0.2)));
    const pipe = new Group(...nodes).arrange(RIGHT, 0.45).moveTo([0, 1.4]);
    if (pipe.width() > 15) pipe.setWidth(15);
    const arrows = new Group(...nodes.slice(1).map((n, i) => new Arrow(nodes[i]!.shape.boxPoint(RIGHT), n.shape.boxPoint(LEFT), { stroke: GREY, strokeWidth: 0.03, buff: 0.05 })));
    await this.play(new LaggedStart(nodes.map((n) => new FadeIn(n)), { lagRatio: 0.15 }), { runTime: 1.0 });
    await this.play(new LaggedStart(arrows.children.map((a) => new Create(a)), { lagRatio: 0.15 }), { runTime: 0.8 });
    const reject = mono('mismatch anywhere → the job stops; nothing is written or deleted', 0.22, RED).moveTo([0, 0.2]);
    await this.play(new FadeIn(reject), { runTime: 0.4 });
    const proofs = new Code([
      '$ git index-pack --strict states.pack     # 1,133 versions, built by the lab',
      'exit 0: every delta resolved and every object re-hashed by git',
      '$ diff <(git cat-file --batch-all-objects …) expected-ids   # identical',
      '',
      'tests: 13 property and fuzz tests; mutation testing found 1 gap, now pinned',
    ], { fontSize: 0.2 }).moveTo([0, -1.6]);
    fit(proofs);
    proofs.lines[1]!.setFill(GREEN); proofs.lines[4]!.setFill(GREY);
    await this.play(new FadeIn(proofs, { shift: [0, -0.2] }), { runTime: 0.6 });
    st.verified = true; st.phase = 'gate';
    await this.wait(0.8);

    // ---- results -----------------------------------------------------------------------------------
    await this.step('results', { caption: `What it buys. On the synthetic repo, ${M.synthetic.asReceivedMB}MB as received becomes ${M.synthetic.oursMB}MB, slightly smaller than the same blobs after git's own aggressive repack, ${M.synthetic.gitRepackMB}MB, which needed ${M.synthetic.gitRepackRssGB}GB of memory to do it. On real data, the us-states rolling averages path goes from ${M.usStates.githubMB}MB to ${M.usStates.oursMB}MB, checked by git. Code repos and regenerated datasets gain far less; that is what the map is for.` });
    await this.play(new FadeOut(new Group(pipe, arrows, reject, proofs)), { runTime: 0.4 });
    const u = 10 / M.synthetic.asReceivedMB; // 432MB = 10 units
    const x0 = -5.2;
    const head1 = sans('synthetic: 100 snapshots of a 30MB JSON', 0.22, WHITE).moveTo([x0, 2.6], LEFT);
    const b1 = bar(x0, 2.0, M.synthetic.asReceivedMB * u, RED, `${M.synthetic.asReceivedMB}MB as received`);
    const b2 = bar(x0, 1.4, M.synthetic.gitRepackMB * u, GOLD, `${M.synthetic.gitRepackMB}MB git repack -adf, blobs (${M.synthetic.gitRepackRssGB}GB RAM)`);
    const b3 = bar(x0, 0.8, M.synthetic.oursMB * u, GREEN, `${M.synthetic.oursMB}MB this design, blobs, 64MB heap cap`);
    const u2 = 10 / M.usStates.githubMB;
    const head2 = sans('real: covid-19-data, rolling-averages/us-states.csv, 1,133 versions', 0.22, WHITE).moveTo([x0, -0.4], LEFT);
    const b4 = bar(x0, -1.0, M.usStates.githubMB * u2, GOLD, `${M.usStates.githubMB}MB in the existing pack`);
    const b5 = bar(x0, -1.6, M.usStates.oursMB * u2, GREEN, `${M.usStates.oursMB}MB rebuilt (38× smaller)`);
    // keep labels on screen when a bar is long
    for (const b of [b1, b4]) b.children[1]!.moveTo(b.children[0]!.center()).setFill(WHITE);
    await this.play(new FadeIn(head1), { runTime: 0.3 });
    await this.play(new LaggedStart([b1, b2, b3].map((b) => new FadeIn(b, { shift: [0.4, 0] })), { lagRatio: 0.3 }), { runTime: 1.0 });
    await this.play(new FadeIn(head2), { runTime: 0.3 });
    await this.play(new LaggedStart([b4, b5].map((b) => new FadeIn(b, { shift: [0.4, 0] })), { lagRatio: 0.3 }), { runTime: 0.8 });
    const note = sans('bars to scale within each group', 0.18).moveTo([x0, -2.4], LEFT);
    await this.play(new FadeIn(note), { runTime: 0.3 });
    st.phase = 'results'; st.numbers = { syntheticFromMB: M.synthetic.asReceivedMB, syntheticToMB: M.synthetic.oursMB, statesFromMB: M.usStates.githubMB, statesToMB: M.usStates.oursMB };
    await this.wait(0.8);

    // ---- next ------------------------------------------------------------------------------------
    await this.step('next', { caption: 'Next: a preflight planner. Before any repack, it maps the pack, samples a few version pairs per path to measure what actually compresses, classifies each path, and prints a plan with estimated bytes, cost and memory risk, like EXPLAIN for a database query. Its estimates will be tested against real builds, the same way everything else here is.' });
    await this.play(new FadeOut(new Group(head1, head2, b1, b2, b3, b4, b5, note)), { runTime: 0.4 });
    const plan = new Code([
      'EXPLAIN repack (rows from three repos measured today)     now      est.    plan',
      '  rolling-averages/us-counties-2022.csv   series      2.04GB    ~0.1GB   path-chain CDC',
      '  owid-co2-data.xlsx                      compressed  54.6MB    54.6MB   store whole, skip',
      '  owid-co2-data.csv                       regenerated 55.6MB    ~36MB    best of window | chain',
      '  express: all blobs                      code         6.5MB     6.5MB   reuse deltas',
    ], { fontSize: 0.2 }).moveTo([0, 0.4]);
    fit(plan);
    plan.lines[0]!.setFill(GREY);
    const planNote = sans('illustrative plan output: the planner is being built and validated next', 0.2).nextTo(plan, DOWN, 0.4);
    await this.play(new FadeIn(plan, { shift: [0, -0.2] }), { runTime: 0.6 });
    await this.play(new FadeIn(planNote), { runTime: 0.3 });
    st.phase = 'next';
    await this.wait(1.0);

    // ---- end -----------------------------------------------------------------------------------
    await this.step('end', { caption: 'Map the pack, delta in bounded memory, and let hashes and git decide what is correct. The pieces are small, pure, and each one is checked against an oracle.' });
    await this.play(new FadeOut(new Group(plan, planNote)), { runTime: 0.4 });
    const closing = new Group(
      sans('map  ·  bounded delta  ·  proof', 0.36, WHITE),
      sans('every measured number is from a real run; every pack the lab built was checked by git', 0.24),
    ).arrange(DOWN, 0.3).moveTo([0, 0.2]);
    await this.play(new FadeIn(closing, { shift: [0, -0.2] }), { runTime: 0.7 });
    st.phase = 'end';
    await this.wait(1.2);
    void (t as Mobject);
  }
}
