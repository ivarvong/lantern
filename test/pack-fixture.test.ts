// The delta picture's object kinds are the fixture pack's wire types.
// small.pack is ply's test/fixtures/viewer/small.pack at 3f07a75.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Scene, NullSink, renderAt, indexScene, RED, Text, Rectangle } from '../src/index.ts';
import type { Mobject } from '../src/index.ts';
import { PlyViewerScene } from '../scenes/ply-viewer.ts';
import { PACK_BYTES, PACK_COMMIT_OID, PACK_OBJECTS, wireName } from '../scenes/lib/small-pack.ts';
import type { PackWire, PackWireObject } from '../scenes/lib/small-pack.ts';

Scene.captionWpm = Infinity;

const FIXTURE_SHA = 'a86b269e52e69445e10d4c1dd7c5a89b323c0988f1d73b1f0b0c7c1d112f846a';
const NAMES: Record<number, PackWire> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag', 6: 'ofs_delta', 7: 'ref_delta' };

function inflateEnd(buf: Buffer, start: number): number {
  let lo = start + 2, hi = buf.length, ok = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    try { inflateSync(buf.subarray(start, mid)); ok = mid; hi = mid - 1; }
    catch { lo = mid + 1; }
  }
  if (ok < 0) throw new Error(`zlib stream at ${start} does not end`);
  return ok;
}

/** Walk the pack the way parsePack does, and keep the wire type of each object. */
function parseFixture(buf: Buffer): PackWireObject[] {
  if (buf.length < 32 || buf.subarray(0, 4).toString() !== 'PACK') throw new Error('not a pack');
  const version = buf.readUInt32BE(4);
  const count = buf.readUInt32BE(8);
  if (version !== 2) throw new Error(`pack version ${version}`);
  const out: PackWireObject[] = [];
  let p = 12;
  for (let i = 0; i < count; i++) {
    const offset = p;
    let c = buf[p++]!;
    const type = (c >> 4) & 7;
    let shift = 4;
    while (c & 0x80) { c = buf[p++]!; shift += 7; }
    const kind = NAMES[type];
    if (!kind) throw new Error(`bad type ${type} at ${offset}`);
    let baseOid: string | undefined;
    if (type === 6) {
      c = buf[p++]!;
      while (c & 0x80) c = buf[p++]!;
    } else if (type === 7) {
      baseOid = buf.subarray(p, p + 20).toString('hex');
      p += 20;
    }
    const end = inflateEnd(buf, p);
    p = end;
    const obj: PackWireObject = { offset, length: end - offset, kind };
    if (baseOid) obj.baseOid = baseOid;
    out.push(obj);
  }
  if (p + 20 !== buf.length) throw new Error(`trailer at ${p}, pack is ${buf.length}`);
  return out;
}

test('the vendored pack is ply small.pack and its wire types are the scene table', () => {
  const buf = readFileSync(new URL('./fixtures/viewer/small.pack', import.meta.url));
  assert.equal(createHash('sha256').update(buf).digest('hex'), FIXTURE_SHA);
  assert.equal(buf.length, PACK_BYTES);
  const parsed = parseFixture(buf);
  assert.deepEqual(parsed, PACK_OBJECTS);
  const ref = parsed.find((o) => o.kind === 'ref_delta');
  assert.ok(ref);
  assert.equal(ref.baseOid, PACK_COMMIT_OID);
  assert.equal(wireName(ref.kind), 'ref-delta');
});

test('the delta frame labels the ref-delta and keeps its slice red', async () => {
  const ix = await indexScene(PlyViewerScene);
  const step = ix.steps.find((s) => s.name === 'delta');
  assert.ok(step);
  const scene = await renderAt(PlyViewerScene, (step.t1 ?? ix.duration) - 0.05, new NullSink());
  const texts: Text[] = [];
  const rects: Rectangle[] = [];
  const walk = (m: Mobject): void => {
    if (m instanceof Text) texts.push(m);
    if (m instanceof Rectangle) rects.push(m);
    for (const c of m.children) walk(c);
  };
  for (const m of scene.mobjects) walk(m);
  const ref = PACK_OBJECTS.find((o) => o.kind === 'ref_delta')!;
  const label = `@${ref.offset} · ${ref.length} B · ref-delta`;
  const hit = texts.find((t) => t.text === label);
  assert.ok(hit, `missing ${label}`);
  assert.equal(hit.children[0]?.style.fill, RED);
  assert.equal(texts.some((t) => t.text.includes(`@${ref.offset}`) && /\bcommit\b/.test(t.text)), false);
  const slice = rects.find((r) => r.key === `pack:${ref.offset}`);
  assert.ok(slice, 'ref-delta slice');
  assert.equal(slice.style.fill, RED);
  assert.equal(slice.measures, true);
});
