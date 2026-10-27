// Contact sheet: one tile per step (or N evenly spaced times), rendered by Chromium to PNG.
//   npm run shot -- <scene> [--times=8] [--out=out/shots/<scene>.png]
import { mkdirSync } from 'node:fs';
import { renderAt, SnapshotSink, traceScene } from '../src/index.ts';
import { SCENES, sceneByName } from '../scenes/index.ts';
import { launch } from './lib/browser.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string | number): string => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? String(d);
const name = args.find((a) => !a.startsWith('--'));
const entry = name == null ? undefined : sceneByName(name);
if (!entry) { console.error(`usage: npm run shot -- <scene> [--times=N]\nscenes: ${Object.keys(SCENES).join(', ')}`); process.exit(2); }
const { Scene } = entry;
const trace = await traceScene(Scene);
const n = Number(opt('times', 0));
// Default: the last frame of every step, i.e. what each step leaves on screen
const marks = n ? Array.from({ length: n }, (_, i) => ({ t: (trace.duration * i) / (n - 1), label: `${((trace.duration * i) / (n - 1)).toFixed(1)}s` }))
  : trace.steps.map((s) => ({ t: Math.max(s.t0, (s.t1 ?? trace.duration) - 0.001), label: s.step }));
const tiles: string[] = [];
for (const m of marks) {
  const sink = new SnapshotSink({ width: 640 });
  await renderAt(Scene, m.t, sink);
  tiles.push(`<figure><div>${sink.svg}</div><figcaption>${m.label}</figcaption></figure>`);
}
const out = opt('out', `out/shots/${name}.png`);
mkdirSync(out.split('/').slice(0, -1).join('/'), { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 400 } });
await page.setContent(`<style>body{margin:0;background:#222;font:12px ui-monospace,monospace;color:#bbb;display:grid;grid-template-columns:repeat(2,640px);gap:8px;padding:8px}
figure{margin:0}figcaption{padding:4px 2px}svg{display:block}</style>${tiles.join('')}`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`${out}: ${marks.length} tiles`);
