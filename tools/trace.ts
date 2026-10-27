// Trace one scene's offline render and print where the time goes.
//   npm run trace -- [scene] [--sink=string|null] [--chrome]
import { writeFileSync, mkdirSync } from 'node:fs';
import { StringSink, perf } from '../src/index.ts';
import { NullSink } from '../src/index.ts';
import { requireScene } from './scene.ts';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) ?? 'pyex-limits';
const sinkKind = (args.find((a) => a.startsWith('--sink=')) ?? '--sink=string').slice(7);
const { Scene } = requireScene(name);

// Warm the JIT and the font cache so the measured run is steady state
await new Scene(new NullSink()).run();

perf.enable({ timelineDepth: 3 });
const sink = sinkKind === 'null' ? new NullSink() : new StringSink({ width: 1280 });
const t0 = performance.now();
const end = perf.begin('run');
const scene = new Scene(sink);
await scene.run();
end();
const ms = performance.now() - t0;
perf.disable();

console.log(`${name} · sink=${sinkKind} · ${scene.frameCount} frames · ${ms.toFixed(0)} ms · ${(ms / scene.frameCount).toFixed(2)} ms/frame\n`);
console.log(perf.report());
if (args.includes('--chrome')) {
  mkdirSync('out', { recursive: true });
  writeFileSync(`out/trace-${name}.json`, perf.chromeTrace());
  console.log(`\nout/trace-${name}.json  (open in ui.perfetto.dev)`);
}
