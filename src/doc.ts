// Document: an explanation as data, and the compiler that plays it.
//
// A doc is plain JSON: nodes, edges and a code block describe what is on
// screen; `state` is what the explanation is about; `steps` are named lists
// of ops that change those. traceScene() returns the same step/state shape,
// so the authoring format and the trace format agree.
// The format is typed below (Doc, DocOp) and described in docs/DOC-FORMAT.md.

import { Scene } from './scene.ts';
import type { SceneOptions, SceneState, Sink, StepMeta } from './scene.ts';
import { Rectangle, Square, Circle, Arrow, CurvedArrow, Labeled } from './shapes.ts';
import { Text } from './text.ts';
import { FadeIn, FadeOut, Create, Write, Transform, Indicate, LaggedStart } from './animation.ts';
import type { Animation } from './animation.ts';
import type { AnimateBuilderBase, Mobject } from './mobject.ts';
import * as C from './color.ts';
import { sub, normalize, mul, add, UP, DOWN } from './vec.ts';
import type { Vec } from './vec.ts';
import { CodePanel, StateReadout } from './panels.ts';

// ---- the format (docs/DOC-FORMAT.md) ---------------------------------------

/** [x, y], a node id (its center), or beside a node, like nextTo. */
export type At = Vec | string | { of: string; dir?: Vec; buff?: number };

export interface DocNodeSpec {
  kind?: 'box' | 'state' | 'slot' | 'pointer' | 'value' | 'text';
  label?: string;
  at?: At;
  color?: string;
  width?: number; height?: number; radius?: number; side?: number;
  fontSize?: number; weight?: 'normal' | 'bold';
}

export interface DocEdgeSpec {
  from: string; to: string;
  label?: string; labelAt?: Vec; labelDir?: Vec;
  color?: string;
  /** Turn in radians, counterclockwise (bulges right of from → to); 0 or absent is straight. */
  curve?: number;
}

/**
 * One play(). Keys are independent: an op may combine several, and an array
 * of ops plays together.
 */
export interface DocOp {
  focus?: number | null;
  add?: DocNodeSpec & { id: string; shift?: Vec };
  remove?: string;
  move?: { id: string; at: At };
  style?: { id: string; color: string; fillOpacity?: number };
  indicate?: string;
  scale?: number;
  set?: Record<string, unknown>;
  note?: string | null;
  at?: Vec;
  color?: string;
  shift?: Vec;
  runTime?: number;
  wait?: number;
}

export interface DocStep {
  name: string;
  meta?: StepMeta;
  ops: Array<DocOp | DocOp[]>;
}

export interface Doc {
  title?: string;
  nodes?: Record<string, DocNodeSpec>;
  edges?: Record<string, DocEdgeSpec>;
  code?: { lines: string[]; at?: Vec; fontSize?: number };
  state?: SceneState;
  readout?: { keys: string[]; at?: Vec; fontSize?: number; gap?: number };
  noteAt?: Vec;
  /** Seconds held after the last step (default 1.5). */
  outro?: number;
  steps: DocStep[];
}

// ---- the compiler -----------------------------------------------------------

const COLORS: Record<string, string> = { blue: C.BLUE, teal: C.TEAL, green: C.GREEN, gold: C.GOLD, red: C.RED, grey: C.GREY, yellow: C.YELLOW, white: C.WHITE, purple: C.PURPLE, orange: C.ORANGE };
const color = (c: string | undefined, d: string = C.GREY): string => (c == null ? d : COLORS[c] ?? c);

/** A node: a shape and/or a label, plus the doc kind that decides its layout. */
class DocNode extends Labeled<Mobject, Text> {
  kind: string = 'box';
}

/** Build a node mobject from its spec. */
function makeNode(spec: DocNodeSpec): DocNode {
  const col = color(spec.color);
  let shape: Mobject | undefined, label: Text | undefined;
  switch (spec.kind ?? 'box') {
    case 'box': {
      label = new Text(spec.label ?? '', { fontSize: spec.fontSize ?? 0.36, color: C.WHITE });
      shape = new Rectangle({ width: spec.width ?? Math.max(2, label.width() + 0.7), height: spec.height ?? 1, cornerRadius: 0.16, stroke: col, strokeWidth: 0.05, fill: col, fillOpacity: 0.12 });
      break;
    }
    case 'state': {
      const r = spec.radius ?? 0.55;
      const fontSize = Math.min(0.26, (2 * r * 0.8) / ((spec.label ?? '').length * 0.6));
      label = new Text(spec.label ?? '', { fontSize, font: 'mono', color: C.WHITE });
      shape = new Circle({ radius: r, stroke: col, strokeWidth: 0.05, fill: col, fillOpacity: 0.12 });
      break;
    }
    case 'slot': {
      const side = spec.side ?? 0.9;
      shape = new Square({ side, stroke: col, strokeWidth: 0.04, fill: col, fillOpacity: 0.08 });
      label = new Text(spec.label ?? '', { fontSize: 0.22, font: 'mono', color: C.GREY });
      label.nextTo(shape, DOWN, 0.1);
      break;
    }
    case 'pointer': {
      shape = new Arrow([0, 0.75], [0, 0.08], { stroke: col, strokeWidth: 0.04, tipLength: 0.22 });
      label = new Text(spec.label ?? '', { fontSize: 0.22, font: 'mono', color: col }).nextTo(shape, UP, 0.06);
      break;
    }
    case 'value': {
      label = new Text(spec.label ?? '', { fontSize: spec.fontSize ?? 0.32, font: 'mono', color: color(spec.color, C.WHITE) });
      break;
    }
    case 'text':
    default: {
      label = new Text(spec.label ?? '', { fontSize: spec.fontSize ?? 0.28, color: color(spec.color, C.WHITE), weight: spec.weight ?? 'normal' });
    }
  }
  // box and state labels sit on the shape; slot and pointer labels were placed beside it
  const g = new DocNode(shape ?? null, label ?? null, { center: false });
  g.kind = spec.kind ?? 'box';
  return g;
}

export interface DocSceneOptions extends SceneOptions { doc?: Doc }

export class DocScene extends Scene {
  /** The doc a sceneFromDoc() class is bound to. */
  declare static doc?: Doc;

  doc: Doc;
  nodes: Record<string, DocNode>;
  edges: Record<string, Labeled>;
  note: Text | null;
  // Present when the doc has a title, a code block, a readout
  title?: Text;
  code?: CodePanel;
  readout?: StateReadout;

  constructor(sink: Sink, opts: DocSceneOptions = {}) {
    super(sink, opts);
    const doc = opts.doc ?? (this.constructor as typeof DocScene).doc;
    if (!doc) throw new Error('DocScene needs a doc (opts.doc or static doc)');
    this.doc = doc;
    this.nodes = {}; this.edges = {}; this.state = { ...(this.doc.state ?? {}) };
    this.note = null;
  }

  /** A node by id; ids come from the doc, so a missing one is an authoring error. */
  private node(id: string): DocNode {
    const g = this.nodes[id];
    if (!g) throw new TypeError(`doc: no node "${id}"`);
    return g;
  }

  /** Resolve an `at` spec to a point, given a mobject to place (for nextTo). */
  resolveAt(at: At, mob?: Mobject): Vec {
    if (Array.isArray(at)) return at;
    if (typeof at === 'string') return this.node(at).shape.center();
    const target = this.node(at.of).shape;
    const dir = at.dir ?? UP, buff = at.buff ?? 0.2;
    if (mob) { mob.nextTo(target, dir, buff); return mob.center(); }
    return add(target.boxPoint(dir), mul(dir, buff));
  }

  placeNode(g: DocNode, at: At): DocNode {
    if (Array.isArray(at)) g.moveTo(at);
    else if (typeof at === 'string') g.moveTo(this.node(at).shape);
    else {
      const target = this.node(at.of).shape;
      const anchor = g.kind === 'pointer' ? g.shape : g;
      anchor.nextTo(target, at.dir ?? UP, at.buff ?? 0.2);
      // A pointer always has both parts (makeNode)
      if (g.kind === 'pointer') g.label!.nextTo(g.shape, UP, 0.06);
    }
    return g;
  }

  makeEdge(spec: DocEdgeSpec): Labeled {
    const a = this.node(spec.from).shape, b = this.node(spec.to).shape;
    const d = normalize(sub(b.center(), a.center()));
    const buff = 0.1;
    const pa = a instanceof Circle ? add(a.center(), mul(d, a.width() / 2 + buff)) : add(a.boxPoint(snap(d)), mul(d, buff));
    const pb = b instanceof Circle ? sub(b.center(), mul(d, b.width() / 2 + buff)) : add(b.boxPoint(snap(mul(d, -1))), mul(d, -buff));
    const col = color(spec.color);
    const e = spec.curve ? new CurvedArrow(pa, pb, { angle: spec.curve, stroke: col }) : new Arrow(pa, pb, { stroke: col });
    let l: Text | null = null;
    if (spec.label) {
      l = new Text(spec.label, { fontSize: 0.2, font: 'mono', color: col });
      if (spec.labelAt) l.moveTo(spec.labelAt); else l.nextTo(e, spec.labelDir ?? UP, 0.08);
    }
    return new Labeled(e, l, { center: false });
  }

  override async construct(): Promise<void> {
    const doc = this.doc;
    await this.step('intro');
    if (doc.title) {
      this.title = new Text(doc.title, { fontSize: 0.4, weight: 'bold', color: C.WHITE }).toEdge(UP, 0.45);
      await this.play(new Write(this.title), { runTime: 0.8 });
    }
    for (const [id, spec] of Object.entries(doc.nodes ?? {})) {
      const g = makeNode(spec); g.key = id; this.nodes[id] = g; this.placeNode(g, spec.at ?? [0, 0]);
    }
    const nodeAnims = Object.values(this.nodes).map((g) => new FadeIn(g, { scale: 0.8 }));
    if (nodeAnims.length) await this.play(new LaggedStart(nodeAnims, { lagRatio: 0.15 }), { runTime: 1 });
    for (const [id, spec] of Object.entries(doc.edges ?? {})) { const g = this.makeEdge(spec); g.key = id; this.edges[id] = g; }
    const edgeAnims = Object.values(this.edges).map((g) => new Create(g));
    if (edgeAnims.length) await this.play(new LaggedStart(edgeAnims, { lagRatio: 0.25 }), { runTime: 1 });

    const extras: Animation[] = [];
    if (doc.code) {
      this.code = new CodePanel(doc.code.lines, { fontSize: doc.code.fontSize ?? 0.24, at: doc.code.at ?? [3.5, 0] });
      extras.push(new FadeIn(this.code, { shift: [0.3, 0] }));
    }
    if (doc.readout) {
      this.readout = new StateReadout(doc.readout.keys.map((k) => [k, this.state[k]] as const), { fontSize: doc.readout.fontSize ?? 0.3, at: doc.readout.at ?? [-6, 0], gap: doc.readout.gap ?? 0.5 });
      extras.push(new FadeIn(this.readout, { shift: [-0.3, 0] }));
    }
    if (extras.length) await this.play(...extras, { runTime: 0.6 });

    for (const step of doc.steps ?? []) {
      await this.step(step.name, step.meta ?? {});
      for (const op of step.ops ?? []) await this.runOps(Array.isArray(op) ? op : [op], step);
    }
    await this.wait(doc.outro ?? 1.5);
  }

  /**
   * Each op in the list is played together, then any removals are applied.
   * A fade-out and a fade-in in the same list do not share a frame: the
   * outgoing text plays to completion, then the incoming text starts, so two
   * labels never sit on top of each other at partial opacity.
   */
  async runOps(ops: readonly DocOp[], _step: DocStep): Promise<void> {
    const outAnims: Array<Animation | AnimateBuilderBase> = [];
    const inAnims: Array<Animation | AnimateBuilderBase> = [];
    let runTime = 0.45;
    let fadesOut = false, fadesIn = false;
    const after: Array<() => void> = [];
    for (const op of ops) {
      if ('wait' in op) { await this.wait(op.wait); continue; }
      if ('runTime' in op) runTime = op.runTime!;
      // A focus op without a code block is an authoring error, and throws here
      if ('focus' in op) inAnims.push(op.focus == null ? this.code!.unfocus() : this.code!.focus(op.focus, color(op.color, C.YELLOW)));
      if (op.add) {
        const g = makeNode(op.add); g.key = op.add.id; this.nodes[op.add.id] = g; this.placeNode(g, op.add.at ?? [0, 0]);
        inAnims.push(new FadeIn(g, { shift: op.add.shift ?? [0, -0.2] }));
        fadesIn = true;
      }
      if (op.remove) { const id = op.remove; const g = this.node(id); outAnims.push(new FadeOut(g, { shift: op.shift ?? [0, 0.4] })); after.push(() => delete this.nodes[id]); fadesOut = true; }
      if (op.move) {
        const g = this.node(op.move.id);
        const target = this.placeNode(g.copy(), op.move.at);
        inAnims.push(new Transform(g, target));
      }
      if (op.style) {
        const g = this.node(op.style.id), col = color(op.style.color);
        const t = g.copy(); t.shape.setStyle({ stroke: col, fill: col });
        if (t.kind === 'slot') t.shape.setStyle({ fillOpacity: op.style.fillOpacity ?? 0.3 });
        if (t.kind === 'pointer') t.label!.setFill(col);
        inAnims.push(new Transform(g, t));
      }
      if (op.indicate) {
        const g = this.nodes[op.indicate] ?? this.edges[op.indicate];
        if (!g) throw new TypeError(`doc: no node or edge "${op.indicate}"`);
        inAnims.push(new Indicate(g.shape, { color: color(op.color, C.YELLOW), scaleFactor: op.scale ?? 1.12 }));
      }
      if (op.set) {
        for (const [k, v] of Object.entries(op.set)) {
          this.state[k] = v;
          const cur = this.readout?.values[k];
          if (cur) {
            const next = new Text(String(v), { fontSize: cur.fontSize, font: 'mono', color: color(op.color, C.WHITE), anchor: 'start' }).moveTo(cur, [-1, 0]);
            inAnims.push(new Transform(cur, next));
          }
        }
      }
      if (op.note != null) {
        if (this.note) { outAnims.push(new FadeOut(this.note)); fadesOut = true; }
        if (op.note) {
          const n = new Text(op.note, { fontSize: 0.28, color: color(op.color, C.GREY) }).moveTo(op.at ?? this.doc.noteAt ?? [0, -3.4]);
          this.note = n; inAnims.push(new FadeIn(n, { shift: [0, -0.2] })); fadesIn = true;
        } else this.note = null;
      }
    }
    // Sequence only when both directions are present. A removal beside a
    // recolor (no new text) still plays together.
    if (fadesOut && fadesIn) {
      if (outAnims.length) await this.play(...outAnims, { runTime: Math.min(runTime, 0.35) });
      if (inAnims.length) await this.play(...inAnims, { runTime });
    } else {
      const anims = [...outAnims, ...inAnims];
      if (anims.length) await this.play(...anims, { runTime });
    }
    for (const f of after) f();
  }
}

/** Snap a direction to the nearest axis, for picking a box edge. */
function snap(d: Vec): Vec { return Math.abs(d[0]) >= Math.abs(d[1]) ? [Math.sign(d[0]), 0] : [0, Math.sign(d[1])]; }

/** Convenience: a Scene subclass bound to one doc. */
export function sceneFromDoc(doc: Doc): typeof DocScene {
  return class extends DocScene { static override doc = doc; };
}
