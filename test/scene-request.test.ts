// The HTTP scene parser: colours, bounds, and shapes that must not reach a renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScene } from '../app/scene-compile.ts';
import { parseColor, parseEnvelope, parsePaint, parsePixels, parseScene, LIMITS } from '../app/scene-request.ts';

const dot = { id: 'a', kind: 'dot', color: 'white' };

function value(result: { ok: true; value: string } | { ok: false }): string {
  assert.equal(result.ok, true);
  if (!result.ok) return '';
  return result.value;
}

test('colours are palette names or hex, and come back canonical', () => {
  assert.equal(value(parseColor('blue', 'c')), '#58c4dd');
  assert.equal(parseColor('BLUE', 'c').ok, false);
  assert.equal(value(parseColor('#abc', 'c')), '#aabbcc');
  assert.equal(value(parseColor('#ABCDEF', 'c')), '#abcdef');
  assert.equal(parseColor('#abcd', 'c').ok, false);
  assert.equal(value(parsePaint('none', 'c')), 'none');
  assert.equal(parseColor('none', 'c').ok, false);
  for (const name of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty', 'red;']) {
    const got = parseColor(name, 'c');
    assert.equal(got.ok, false, name);
    if (!got.ok) assert.equal(got.errors.some((e) => e.message.includes(name)), false);
  }
});

test('width is an integer inside the pixel range', () => {
  assert.equal(parsePixels(32, 'w').ok, true);
  assert.equal(parsePixels(1280, 'w').ok, true);
  for (const n of [31, 1281, 640.5, Infinity, -1, Number.NaN]) assert.equal(parsePixels(n, 'w').ok, false, String(n));
  const wide = parsePixels('1280" onload="alert(1)', 'w');
  assert.equal(wide.ok, false);
});

test('a scene rejects unknown fields, prototype keys, controls, and duplicate ids', () => {
  const bad: unknown[] = [
    { objects: [{ ...dot, kind: 'nope' }] },
    { objects: [{ ...dot, unexpected: 1 }] },
    { objects: [dot, { id: 'a', kind: 'dot' }] },
    { objects: [{ ...dot, id: '__proto__' }] },
    { objects: [{ id: 'a', kind: 'text', text: 'a\u0000b' }] },
    JSON.parse('{"objects":[{"id":"a","kind":"dot"}],"state":{"__proto__":1}}'),
    { objects: [dot], state: { constructor: { polluted: true } } },
    { objects: [{ id: 'g', kind: 'group', children: ['g'] }] },
    { objects: [{ id: 'a', kind: 'flowchart', source: 'flowchart LR\nA:::bad' }] },
    { objects: [{ id: 'a', kind: 'flowchart', source: 'flowchart LR\nstyle A fill:#fff' }] },
    { objects: [{ id: 'a', kind: 'flowchart', source: 'flowchart LR\nclassDef x fill:#fff' }] },
    { objects: [{ id: 'a', kind: 'flowchart', source: 'flowchart LR\nlinkStyle 0 stroke:#fff' }] },
  ];
  for (const scene of bad) {
    const got = parseScene(scene);
    assert.equal(got.ok, false, JSON.stringify(scene));
  }
  const polluted = ({} as { polluted?: boolean }).polluted;
  parseScene(JSON.parse('{"objects":[{"id":"a","kind":"dot","__proto__":{"polluted":true}}]}'));
  assert.equal(({} as { polluted?: boolean }).polluted, polluted);
});

test('a small scene parses, and the frame cap fails closed', () => {
  const ok = parseScene({ fps: 4, objects: [dot], steps: [{ name: 'in', plays: [{ animations: [{ kind: 'fadeIn', target: 'a' }], runTime: 0.25 }] }] });
  assert.equal(ok.ok, true);
  const huge = parseEnvelope({
    scene: { fps: 20, objects: [dot], steps: [{ name: 'in', plays: [{ animations: [{ kind: 'fadeIn', target: 'a' }], runTime: 4 }] }] },
    output: { format: 'frames' },
  });
  assert.equal(huge.ok, false);
  const over = parseScene({
    fps: LIMITS.fpsMax,
    objects: [dot],
    steps: Array.from({ length: LIMITS.steps }, (_, i) => ({
      name: `s${i}`,
      plays: [{ animations: [{ kind: 'fadeIn', target: 'a' }], runTime: LIMITS.runMax }],
    })),
  });
  assert.equal(over.ok, false);
});

test('moveAlong only accepts a path shape', () => {
  const scene = parseScene({
    objects: [
      { id: 'a', kind: 'dot' },
      { id: 'p', kind: 'text', text: 'x' },
    ],
    steps: [{ name: 'go', plays: [{ animations: [{ kind: 'moveAlong', target: 'a', path: 'p' }] }] }],
  });
  assert.equal(scene.ok, true);
  if (!scene.ok) return;
  const compiled = compileScene(scene.value);
  assert.equal(compiled.ok, false);
});
