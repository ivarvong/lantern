// Serializer and registry boundaries: illegal options and inherited keys fail
// closed, and a paint that contains a control character still serializes as XML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, NullSink, SnapshotSink, Rectangle, toSvgString, loadFonts, sceneFromDoc } from '../src/index.ts';
import type { FontName } from '../src/index.ts';
import { shaperFor } from '../src/fonts.ts';
import { assertSvg } from './lib/svg-oracle.ts';

test('width and background are checked before they are written', () => {
  const scene = new Scene(new NullSink());
  const width = { valueOf: () => 200, toString: () => 'wide' };
  assert.throws(() => toSvgString(scene, { width: width as unknown as number }), /svg width/);
  const background = { toString: () => 'not-a-colour' };
  assert.throws(() => toSvgString(scene, { background: background as unknown as string }), /svg background/);
  assert.throws(() => toSvgString(scene, { width: Number.POSITIVE_INFINITY }), /svg width/);
  assert.throws(() => toSvgString(scene, { width: Number.NaN }), /svg width/);
  assert.throws(() => toSvgString(scene, { width: 1.5 }), /svg width/);
  assert.throws(() => toSvgString(scene, { width: 0 }), /svg width/);
  assert.throws(() => toSvgString(scene, { width: 4097 }), /svg width/);
  assert.throws(() => toSvgString(scene, { background: '#112233\u0000' }), /svg background/);
  assert.throws(() => toSvgString(scene, { background: 'red' }), /svg background/);
  const svg = toSvgString(scene, { width: 100, background: '#ABC' });
  assertSvg(svg, { width: 100, background: '#aabbcc' });
});

test('a control character in a paint stays well-formed XML', () => {
  const scene = new Scene(new NullSink());
  scene.add(new Rectangle({ width: 1, height: 1, fill: 'a\u0000b"<&', stroke: 'none' }));
  const svg = toSvgString(scene, { width: 100, background: '#112233' });
  assert.equal(svg.includes('\u0000'), false);
  assertSvg(svg, { width: 100, background: '#112233' });
  assert.match(svg, /fill="ab&quot;&lt;&amp;"/);
});

test('font lookup does not follow the prototype', async () => {
  await loadFonts();
  for (const name of ['toString', 'constructor', '__proto__'] as unknown as FontName[]) {
    assert.throws(() => shaperFor(name), /Unknown font/);
  }
  const hostile = { toString: () => 'sans' };
  assert.throws(() => shaperFor(hostile as unknown as FontName), /Unknown font/);
  assert.equal(typeof shaperFor('sans'), 'function');
  assert.equal(typeof shaperFor('mono'), 'function');
});

test('document colours are palette names or hex', async () => {
  const Bad = sceneFromDoc({
    steps: [{ name: 'a', ops: [] }],
    nodes: { n: { kind: 'box', color: 'constructor', label: 'x' } },
  });
  await assert.rejects(new Bad(new NullSink()).run(), /Unknown colour/);
  const Ok = sceneFromDoc({
    steps: [{ name: 'a', ops: [] }],
    nodes: { n: { kind: 'value', color: '#abc', label: 'n' } },
  });
  const sink = new SnapshotSink({ width: 160, background: '#112233' });
  await new Ok(sink).run();
  assertSvg(sink.svg, { width: 160, background: '#112233' });
});
