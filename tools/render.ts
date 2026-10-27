// Offline render: no DOM, no deps. Writes one SVG per frame for each scene.
//   npm run render -- [scene ...]   writes out/frames/<scene>/f0000.svg ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { StringSink } from '../src/index.ts';
import { requireScene } from './scene.ts';
import { SCENES } from '../scenes/index.ts';

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
const fps = 30;

for (const name of names) {
  const { Scene } = requireScene(name);
  const outDir = new URL(`../out/frames/${name}/`, import.meta.url).pathname;
  mkdirSync(outDir, { recursive: true });
  const sink = new StringSink({ width: 1280 });
  const t0 = performance.now();
  await new Scene(sink, { fps }).run();
  const ms = performance.now() - t0;
  sink.frames.forEach((svg, i) => writeFileSync(`${outDir}f${String(i).padStart(4, '0')}.svg`, svg));
  console.log(`${name}: ${sink.frames.length} frames (${(sink.frames.length / fps).toFixed(1)}s) in ${ms.toFixed(0)}ms, ${(ms / sink.frames.length).toFixed(2)}ms/frame`);
}
