// Motion verifier over scenes: every frame, every drawn leaf.
//   npm run verify:motion -- [scene ...] [--all-events]
import { MotionSink, analyzeMotion, summarizeMotion } from '../src/index.ts';
import { SCENES } from '../scenes/index.ts';
import { requireScene } from './scene.ts';
const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));
let total = 0;
for (const name of names.length ? names : Object.keys(SCENES)) {
  const sink = new MotionSink();
  const { Scene } = requireScene(name);
  await new Scene(sink).run();
  const events = analyzeMotion(sink);
  total += events.length;
  const byKind = events.reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
  console.log(`\n${name}: ${sink.frames.length} frames, ${events.length} events ${JSON.stringify(byKind)}`);
  for (const g of summarizeMotion(events)) {
    console.log(`  ${g.t.toFixed(2).padStart(6)}s  ${g.kind.padEnd(8)} ×${String(g.count).padEnd(3)} [${g.step ?? '—'}]  ${g.examples[0]}`);
  }
}
process.exitCode = total ? 1 : 0;
