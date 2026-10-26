// The ring buffer explainer as a document (docs/DOC-FORMAT.md). A loop
// generates the ops; ring-buffer.doc.json beside this file is the same doc
// as plain JSON, kept in sync by a test (UPDATE_GOLDEN=1 rewrites it).

const CAP = 6, SIDE = 0.9, GAP = 0.12;
import type { At, Doc, DocNodeSpec, DocOp, DocStep } from '../src/index.ts';

const slotX = (i: number): number => +((i - (CAP - 1) / 2) * (SIDE + GAP)).toFixed(3);

const nodes: Record<string, DocNodeSpec> = {};
for (let i = 0; i < CAP; i++) nodes[`s${i}`] = { kind: 'slot', label: String(i), at: [slotX(i), 1.2], color: 'grey' };
// A pointer sits above its slot; when head and tail share a slot they stand
// side by side (head left, tail right) instead of on top of each other.
const SPLIT = 0.5;
const pointerAt = (slot: number, side: number): At => ({ of: `s${slot}`, dir: [side * SPLIT, 1], buff: 0.1 });
const movePointers = (h: number, t: number): DocOp[] => (h === t
  ? [{ move: { id: 'head', at: pointerAt(h, -1) } }, { move: { id: 'tail', at: pointerAt(t, 1) } }]
  : [{ move: { id: 'head', at: pointerAt(h, 0) } }, { move: { id: 'tail', at: pointerAt(t, 0) } }]);
nodes.head = { kind: 'pointer', label: 'head', color: 'teal', at: pointerAt(0, -1) };
nodes.tail = { kind: 'pointer', label: 'tail', color: 'gold', at: pointerAt(0, 1) };

const steps: DocStep[] = [];
let head = 0, tail = 0, len = 0;
const slots = new Array<string | null>(CAP).fill(null);

function push(v: string, color: string): void {
  const ops: DocStep['ops'] = [
    [{ focus: 2 }, { add: { id: `v${v}`, kind: 'value', label: v, at: [-7.15, 1.2] } }],
    [{ move: { id: `v${v}`, at: `s${tail}` } }, { style: { id: `s${tail}`, color } }],
  ];
  slots[tail] = v;
  const next = (tail + 1) % CAP;
  ops.push([{ focus: 3 }, ...movePointers(head, next), { set: { tail: next } }]);
  tail = next; len++;
  ops.push([{ focus: 4 }, { set: { len } }]);
  steps.push({ name: `push-${v}`, meta: { op: 'push', value: v }, ops });
}

function pop(): void {
  const v = slots[head];
  const ops: DocStep['ops'] = [
    [{ focus: 7 }, { indicate: `v${v}` }],
    [{ remove: `v${v}` }, { style: { id: `s${head}`, color: 'grey', fillOpacity: 0.08 } }],
  ];
  slots[head] = null;
  const next = (head + 1) % CAP;
  ops.push([{ focus: 8 }, ...movePointers(next, tail), { set: { head: next } }]);
  head = next; len--;
  ops.push([{ focus: 9 }, { set: { len } }]);
  steps.push({ name: `pop-${v}`, meta: { op: 'pop', value: v }, ops });
}

for (const v of ['a', 'b', 'c', 'd', 'e']) push(v, 'blue');
pop(); pop();
push('f', 'green');
steps.push({ name: 'wrap', meta: { note: 'tail wraps from 5 to 0' }, ops: [[{ focus: 3, color: 'green' }, { note: 'tail wraps: (5 + 1) % 6 = 0', at: [-3.5, -1.4], color: 'green' }]] });
push('g', 'green');
steps.push({ name: 'done', ops: [{ focus: null }] });

export const ringBufferDoc: Doc = {
  title: 'Ring buffer: head, tail and length are the whole state',
  nodes,
  code: {
    at: [3.6, -1.6], fontSize: 0.24,
    lines: [
      'push(x) {',
      '  if (this.len === CAP) throw new Full();',
      '  this.buf[this.tail] = x;',
      '  this.tail = (this.tail + 1) % CAP;',
      '  this.len++;',
      '}',
      'pop() {',
      '  const x = this.buf[this.head];',
      '  this.head = (this.head + 1) % CAP;',
      '  this.len--; return x;',
      '}',
    ],
  },
  state: { head: 0, tail: 0, len: 0 },
  readout: { keys: ['head', 'tail', 'len'], at: [-6.4, 1.7], gap: 0.5 },
  steps,
};
