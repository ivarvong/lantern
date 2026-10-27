// Benchmarks with a baseline and a regression gate.
//
//   npm run bench                 measure, compare with bench/baseline.json, fail on regression
//   npm run bench -- --update     measure and write the baseline
//   npm run bench -- --json       print the measurements as JSON
//
// Each number is the minimum of several runs in one process after a warm-up:
// for CPU-bound work the minimum is the estimate least disturbed by whatever
// else the machine was doing (medians here moved ±20% run to run on a shared
// 2-vCPU VM; minima ±5%). The gate is 25% slower than baseline on any metric
// and more than a GC pause's worth in absolute terms (0.15 ms/frame, 15 ms).
// It is a local check, not CI: shared runners are too noisy.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { Scene, StringSink, SnapshotSink, renderElements, traceScene, renderAt, indexScene, loadFonts } from '../src/index.ts';
import type { SceneClass } from '../src/index.ts';
import { SCENES, sceneByName } from '../scenes/index.ts';

Scene.captionWpm = Infinity; // measure animation, not caption holds
const args = process.argv.slice(2);
const file = new URL('../bench/baseline.json', import.meta.url).pathname;
const REPS = 7, TOLERANCE = 0.25;
const best = (xs: number[]): number => Math.min(...xs);
async function timed(f: () => Promise<unknown>, reps = REPS): Promise<number> {
  await f(); // warm-up
  const xs: number[] = [];
  for (let i = 0; i < reps; i++) { const t0 = performance.now(); await f(); xs.push(performance.now() - t0); }
  return best(xs);
}

/** One scene's numbers: `frames`, then the metrics, keyed as baseline.json keys them. */
type Metrics = Record<string, number>;

await loadFonts();
async function measure(_name: string, S: SceneClass): Promise<Metrics> {
  let frames = 0;
  // Offline SVG strings, every frame: what Node and Workers do
  const strings = await timed(async () => { const sink = new StringSink(); frames = 0; await new S({ async frame(sc) { frames++; await sink.frame(sc); } }).run(); });
  // DOM records, every frame: what the player does (minus the DOM)
  const records = await timed(async () => { await new S({ async frame(sc) { renderElements(sc, { relative: false }); } }).run(); });
  // What a deep link costs: index + seek to the middle
  const ix = await indexScene(S);
  const mid = ix.duration / 2;
  const seek = await timed(async () => { await indexScene(S); await renderAt(S, mid, new SnapshotSink()); });
  const trace = await timed(() => traceScene(S));
  return {
    frames,
    'string ms/frame': +(strings / frames).toFixed(3),
    'records ms/frame': +(records / frames).toFixed(3),
    'seek ms': +seek.toFixed(1),
    'trace ms': +trace.toFixed(1),
  };
}
const results: Record<string, Metrics> = {};
for (const [name, { Scene: S }] of Object.entries(SCENES)) results[name] = await measure(name, S);

if (args.includes('--json')) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

const baseline: Record<string, Metrics> | null = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, Metrics> : null;
const floorOf = (k: string): number => (k.endsWith('ms/frame') ? 0.15 : 15);
// Both relative and absolute: a 12 ms metric moving 6 ms is one GC pause, not a regression
const regressed = (k: string, v: number, b: number): boolean => v / b - 1 > TOLERANCE && v - b > floorOf(k);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
function report(results: Record<string, Metrics>, worstOut: { v: number }): void {
  console.log(pad('scene', 15) + pad('frames', 8) + pad('string ms/f', 13) + pad('records ms/f', 14) + pad('seek ms', 10) + 'trace ms');
  for (const [name, r] of Object.entries(results)) {
    const b = baseline?.[name];
    const cell = (k: string, w: number): string => {
      const v = r[k]!, bk = b?.[k];
      if (bk == null) return pad(v, w);
      const d = v / bk - 1;
      worstOut.v = Math.max(worstOut.v, d);
      return pad(`${v} ${d >= 0 ? '+' : ''}${(100 * d).toFixed(0)}%`, w);
    };
    console.log(pad(name, 15) + pad(r.frames!, 8) + cell('string ms/frame', 13) + cell('records ms/frame', 14) + cell('seek ms', 10) + cell('trace ms', 10));
  }
}
const worst = { v: 0 };
report(results, worst);
if (args.includes('--update') || !baseline) {
  mkdirSync(new URL('../bench/', import.meta.url).pathname, { recursive: true });
  writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  console.log(`\nbaseline written: bench/baseline.json`);
} else {
  // A regression must reproduce: re-measure flagged scenes once (a shared VM's
  // steal time can double a 40 ms measurement for one run, even as a minimum of 7)
  const flagged = Object.entries(results).filter(([name, r]) => Object.keys(r).some((k) => k !== 'frames' && regressed(k, r[k]!, baseline[name]?.[k] ?? Infinity)));
  const confirmed: string[] = [];
  for (const [name] of flagged) {
    const again = await measure(name, sceneByName(name)!.Scene);
    // Flagged means the baseline has this scene and metric (a missing one compares to Infinity)
    const base = baseline[name]!, now = results[name]!;
    for (const k of Object.keys(again)) if (k !== 'frames' && regressed(k, now[k]!, base[k]!) && regressed(k, again[k]!, base[k]!)) {
      confirmed.push(`${name} ${k}: ${base[k]} → ${now[k]}, again ${again[k]}`);
    }
  }
  if (confirmed.length) { console.log(`\nREGRESSION (> ${100 * TOLERANCE}% slower than baseline, twice):\n  ${confirmed.join('\n  ')}`); process.exit(1); }
  console.log(`\nok: within ${100 * TOLERANCE}% of baseline${flagged.length ? ` (${flagged.length} flagged, none reproduced)` : ''} (worst single +${(100 * worst.v).toFixed(0)}%)`);
}
