// CPU profile of one scene's render, in-process, summarized by self time.
//   npm run profile -- [scene] [--sink=string|dom|null] [--top=18]
import { Session } from 'node:inspector/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderElements, toSvgString } from '../src/index.ts';
import type { Sink } from '../src/index.ts';
import { requireScene } from './scene.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string | number): string => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? String(d);
const name = args.find((a) => !a.startsWith('--')) ?? 'pyex-limits';
const sinkKind = opt('sink', 'string');
const { Scene } = requireScene(name);
const sink: Sink = { async frame(scene) {
  if (sinkKind === 'string') toSvgString(scene);
  else if (sinkKind === 'dom') renderElements(scene, { relative: false });
} };
await new Scene(sink).run(); // warm up: JIT, fonts, shaping

const session = new Session(); session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: 100 });
await session.post('Profiler.start');
const t0 = performance.now(); const scene = new Scene(sink); await scene.run(); const ms = performance.now() - t0;
const { profile } = await session.post('Profiler.stop');
mkdirSync('out', { recursive: true }); writeFileSync(`out/${name}.cpuprofile`, JSON.stringify(profile));

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>(); let total = 0;
(profile.samples ?? []).forEach((id, i) => {
  const f = byId.get(id)!.callFrame, dt = profile.timeDeltas?.[i] ?? 0;
  const key = `${f.functionName || '(anon)'}  ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + dt); total += dt;
});
console.log(`${name} · sink=${sinkKind} · ${scene.frameCount} frames · ${(ms / scene.frameCount).toFixed(2)} ms/frame · out/${name}.cpuprofile\n`);
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(opt('top', 18)))) {
  console.log(`${(us / 1000).toFixed(0).padStart(6)} ms ${(100 * us / total).toFixed(1).padStart(5)}%  ${k}`);
}
