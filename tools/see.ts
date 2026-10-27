// See one frame without a browser.
//   npm run see -- <scene> [step | seconds] [--svg file.svg]
// Prints the frame as text (src/ascii.ts), plus the step's state diff from the trace.
import { writeFileSync } from 'node:fs';
import { renderAt, renderText, traceScene, toSvgString } from '../src/index.ts';
import { SCENES, sceneByName } from '../scenes/index.ts';

const args = process.argv.slice(2);
const svgOut = args.includes('--svg') ? args[args.indexOf('--svg') + 1] : null;
const [name, at] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--svg');
const entry = name == null ? undefined : sceneByName(name);
if (!entry) {
  console.error(`usage: npm run see -- <scene> [step | seconds] [--svg file]\nscenes: ${Object.keys(SCENES).join(', ')}`);
  process.exit(2);
}
const { Scene } = entry;
const trace = await traceScene(Scene);
const step = at == null ? null : trace.steps.find((s) => s.step === at || s.step.endsWith('/' + at));
const t = at == null ? trace.duration : step ? step.t0 : Number(at);
if (Number.isNaN(t)) { console.error(`no step "${at}"; steps: ${trace.steps.map((s) => s.step).join(', ')}`); process.exit(2); }

const scene = await renderAt(Scene, t, { async frame() {} });
console.log(renderText(scene));
const s = step ?? trace.steps.findLast((x) => x.t0 <= t + 1e-9);
if (s) {
  const changed = Object.keys({ ...s.before, ...s.after }).filter((k) => JSON.stringify(s.before?.[k]) !== JSON.stringify(s.after?.[k]));
  console.log(`\n${name} · step ${s.step} · t=${t.toFixed(2)}s of ${trace.duration}s` + (changed.length ? ` · ${changed.map((k) => `${k}: ${JSON.stringify(s.before?.[k])} → ${JSON.stringify(s.after?.[k])}`).join(', ')}` : ''));
}
if (svgOut) { writeFileSync(svgOut, toSvgString(scene)); console.log(`wrote ${svgOut}`); }
