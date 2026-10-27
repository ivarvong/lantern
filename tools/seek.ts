// Cold and warm cost of the operations the player and Worker do on a deep link.
import { traceScene, renderAt, SnapshotSink, NullSink } from '../src/index.ts';
import { requireScene } from './scene.ts';
const name = process.argv[2] ?? 'pyex-limits';
const { Scene } = requireScene(name);
const time = async (f: () => Promise<unknown>): Promise<number> => { const t0 = performance.now(); await f(); return performance.now() - t0; };
const cold = await time(() => traceScene(Scene));
const trace = await traceScene(Scene);
const tr: number[] = []; for (let i = 0; i < 5; i++) tr.push(await time(() => traceScene(Scene)));
const target = trace.steps.find((s) => s.step === 'exceeded')?.t0 ?? trace.duration * 0.7;
const sk: number[] = []; for (let i = 0; i < 5; i++) sk.push(await time(() => renderAt(Scene, target, new SnapshotSink())));
const full = await time(() => new Scene(new NullSink(), { skipUntil: 0 }).run());
const med = (a: number[]): string => a.sort((x, y) => x - y)[a.length >> 1]!.toFixed(1);
console.log(`${name}: trace cold ${cold.toFixed(0)} ms, warm ${med(tr)} ms · seek to t=${target.toFixed(1)}s ${med(sk)} ms · (unskipped run ${full.toFixed(0)} ms)`);
