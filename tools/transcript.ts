// The transcript of a scene: every step's caption with its time, as Markdown
// (or WebVTT with --vtt), straight from the trace, so it cannot drift from
// what the player shows.
//   npm run transcript -- <scene> [--vtt] > out/<scene>.md
import { traceScene, Scene } from '../src/index.ts';
import { SCENES, sceneByName } from '../scenes/index.ts';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
const entry = name == null ? undefined : sceneByName(name);
if (!entry) { console.error(`usage: npm run transcript -- <scene> [--vtt]\nscenes: ${Object.keys(SCENES).join(', ')}`); process.exit(2); }
const { steps } = await traceScene(entry.Scene);
const cues = steps.filter((s) => s.meta?.caption).map((s) => ({ name: s.step, t0: s.t0, t1: s.t1, text: String(s.meta.caption) }));
// A step's t1 is unset only if the run stopped inside it, which a full trace never does
const clock = (t: number | undefined): string => `${String(Math.floor(t! / 60)).padStart(2, '0')}:${(t! % 60).toFixed(3).padStart(6, '0')}`;

if (args.includes('--vtt')) {
  console.log('WEBVTT\n');
  for (const c of cues) console.log(`${c.name}\n${clock(c.t0)} --> ${clock(c.t1)}\n${c.text}\n`);
} else {
  const total = steps.at(-1)?.t1 ?? 0;
  console.log(`# ${entry.label}\n\nTranscript, ${cues.length} captions, ${total.toFixed(0)} s. Times are where each caption begins in the player (\`?scene=${name}&step=<name>\`).\n`);
  for (const c of cues) console.log(`**${clock(c.t0).slice(0, 5)} · ${c.name}**  \n${c.text}\n`);
  const words = cues.reduce((n, c) => n + c.text.split(/\s+/).length, 0);
  console.log(`---\n${words} words; at ${Scene.captionWpm} wpm that is ${(words / Scene.captionWpm * 60).toFixed(0)} s of speech against ${total.toFixed(0)} s of animation.`);
}
