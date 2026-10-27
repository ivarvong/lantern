// Turn a parsed scene into a Scene subclass.
//
// Every value here is already a branded colour, length, or identifier.
// Constructors are chosen with a switch on `kind`, and method names on an
// animation are chosen the same way: a request string is never used as a key.

import {
  AnimationGroup, Arc, ArcBetweenPoints, Arrow, Card, Circle, Code, CodePanel, Create, CurvedArrow,
  DecimalNumber, Dot, FadeIn, FadeOut, Flash, Flowchart, Group, Indicate, LaggedStart, Line, Labeled,
  MoveAlongPath, Polygon, Rectangle, Scene, Square, StateReadout, Text, Transform, VMobject, Write,
  flowchart, linear, parseMermaid, route, rushFrom, rushInto, smooth, thereAndBack,
  title, wiggle, easeInQuad, easeOutBack, easeOutQuad,
} from '../src/index.ts';
import { prepareAnimation } from '../src/animation.ts';
import type {
  AnimOpts as LibAnimOpts, Animation, Mobject, Playable, PlayOpts, RateFunc, SceneClass, SceneOptions, Sink, Style as LibStyle,
} from '../src/index.ts';
import type { Fail } from './result.ts';
import { fail, ok } from './result.ts';
import type { Result } from './result.ts';
import { LIMITS } from './scene-request.ts';
import type {
  Anim, AnimOpts, AnimateCall, Id, InlineMob, Mob, Play, RateName, SceneDoc, Style, Vec,
} from './scene-request.ts';

/** A scene that cannot be built. The message is fixed; it does not quote the request. */
export class SceneRejected extends Error {
  readonly errors: readonly Fail[];
  constructor(errors: readonly Fail[]) {
    super('scene rejected');
    this.name = 'SceneRejected';
    this.errors = errors;
  }
}

function reject(path: string, message: string): never {
  throw new SceneRejected([{ path, message }]);
}

function point(v: Vec): [number, number] {
  return [v[0], v[1]];
}

function libStyle(style: Style): LibStyle {
  return { ...style };
}

function fontName(font: 'sans' | 'mono'): 'sans' | 'mono' {
  switch (font) {
    case 'mono': return 'mono';
    case 'sans': return 'sans';
  }
}

function rateOf(name: RateName): RateFunc {
  switch (name) {
    case 'linear': return linear;
    case 'smooth': return smooth;
    case 'rushInto': return rushInto;
    case 'rushFrom': return rushFrom;
    case 'thereAndBack': return thereAndBack;
    case 'easeInQuad': return easeInQuad;
    case 'easeOutQuad': return easeOutQuad;
    case 'easeOutBack': return easeOutBack;
    case 'wiggle': return wiggle;
  }
}

function animOpts(a: AnimOpts): LibAnimOpts {
  const opts: LibAnimOpts = {};
  if (a.runTime !== undefined) opts.runTime = a.runTime;
  if (a.lagRatio !== undefined) opts.lagRatio = a.lagRatio;
  if (a.remover !== undefined) opts.remover = a.remover;
  if (a.rate !== undefined) opts.rateFunc = rateOf(a.rate);
  return opts;
}

function isPathKind(kind: Mob['kind']): boolean {
  switch (kind) {
    case 'rectangle': case 'square': case 'circle': case 'dot':
    case 'line': case 'polygon': case 'arc': case 'arcBetween':
      return true;
    default:
      return false;
  }
}

function checkPaths(doc: SceneDoc): Result<SceneDoc> {
  const byId = new Map(doc.objects.map((o) => [o.id, o]));
  const errors: Fail[] = [];
  const walk = (anim: Anim, path: string): void => {
    if (anim.kind === 'group' || anim.kind === 'lagged') {
      anim.animations.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (anim.kind !== 'moveAlong') return;
    const target = byId.get(anim.path);
    if (target && !isPathKind(target.kind)) errors.push({ path, message: 'moveAlong path must be a line, arc, or other path shape' });
  };
  for (const step of doc.steps) for (const play of step.plays) {
    if (play.kind !== 'play') continue;
    play.animations.forEach((anim, i) => walk(anim, `steps.${step.name}.animations[${i}]`));
  }
  return errors.length ? { ok: false, errors } : ok(doc);
}

function checkFlows(doc: SceneDoc): Result<SceneDoc> {
  const errors: Fail[] = [];
  for (const o of doc.objects) {
    if (o.kind !== 'flowchart') continue;
    try { parseMermaid(o.source); }
    catch { errors.push({ path: `scene.objects.${o.id}`, message: 'flowchart source could not be parsed' }); }
  }
  return errors.length ? { ok: false, errors } : ok(doc);
}

function callsOf(mob: Mobject, calls: readonly AnimateCall[]): Playable {
  let builder = mob.animate;
  for (const call of calls) {
    switch (call.method) {
      case 'shift': builder = builder.shift(point(call.by)); break;
      case 'moveTo': builder = builder.moveTo(point(call.at)); break;
      case 'scale': builder = builder.scale(call.factor); break;
      case 'rotate': builder = builder.rotate(call.angle); break;
      case 'setFill':
        builder = call.fillOpacity == null ? builder.setFill(call.fill) : builder.setFill(call.fill, call.fillOpacity);
        break;
      case 'setStroke':
        builder = builder.setStroke(call.stroke, call.strokeWidth ?? undefined, call.strokeOpacity ?? undefined);
        break;
      case 'setOpacity': builder = builder.setOpacity(call.opacity); break;
    }
  }
  return builder;
}

function inlineMob(spec: InlineMob): Mobject {
  switch (spec.kind) {
    case 'rectangle':
      return new Rectangle({ width: spec.width, height: spec.height, cornerRadius: spec.cornerRadius, ...libStyle(spec.style) });
    case 'square':
      return new Square({ side: spec.side, cornerRadius: spec.cornerRadius, ...libStyle(spec.style) });
    case 'circle':
      return new Circle({ radius: spec.radius, ...libStyle(spec.style) });
    case 'dot':
      return new Dot({ radius: spec.radius, color: spec.color });
    case 'text':
      return new Text(spec.text, {
        fontSize: spec.fontSize, font: fontName(spec.font), weight: spec.weight, anchor: spec.anchor,
        color: spec.color, fillOpacity: spec.fillOpacity,
      });
  }
}

type Built = Map<Id, Mobject>;

function take(built: Built, id: Id): Mobject {
  const mob = built.get(id);
  if (!mob) return reject('scene.objects', 'unknown object');
  return mob;
}

function asPath(mob: Mobject): VMobject {
  if (!(mob instanceof VMobject)) return reject('path', 'moveAlong path must be a line, arc, or other path shape');
  return mob;
}

function asPanel(mob: Mobject): CodePanel {
  if (!(mob instanceof CodePanel)) return reject('focus', 'focus target must be a codePanel');
  return mob;
}

function asChart(mob: Mobject): Flowchart {
  if (!(mob instanceof Flowchart)) return reject('reveal', 'reveal target must be a flowchart');
  return mob;
}

function leafOf(built: Built, anim: Exclude<Anim, { kind: 'group' | 'lagged' }>): Playable {
  const mob = take(built, anim.target);
  const opts = animOpts(anim);
  switch (anim.kind) {
    case 'fadeIn': return new FadeIn(mob, { ...opts, shift: anim.shift ? point(anim.shift) : null, scale: anim.scale });
    case 'fadeOut': return new FadeOut(mob, { ...opts, shift: anim.shift ? point(anim.shift) : null, scale: anim.scale });
    case 'create': return new Create(mob, opts);
    case 'write': return new Write(mob, opts);
    case 'indicate': return new Indicate(mob, { ...opts, color: anim.color, scaleFactor: anim.scaleFactor });
    case 'flash': return new Flash(mob, opts);
    case 'transform': return new Transform(mob, inlineMob(anim.to), { ...opts, replace: anim.replace });
    case 'moveAlong': return new MoveAlongPath(mob, asPath(take(built, anim.path)), { ...opts, fromCurrent: anim.fromCurrent });
    case 'animate': return callsOf(mob, anim.calls);
    case 'focus': {
      const panel = asPanel(mob);
      if (anim.line >= panel.code.lines.length) reject('focus', 'focus line is past the end of the code');
      return panel.focus(anim.line, anim.color);
    }
    case 'unfocus': return asPanel(mob).unfocus();
  }
}

function groupOf(built: Built, anim: Extract<Anim, { kind: 'group' | 'lagged' }>): Animation {
  const parts = anim.animations.map((leaf) => prepareAnimation(leafOf(built, leaf)));
  const opts = animOpts({ runTime: anim.runTime, rate: anim.rate, lagRatio: anim.lagRatio });
  return anim.kind === 'lagged' ? new LaggedStart(parts, opts) : new AnimationGroup(parts, opts);
}

function playable(built: Built, anim: Anim): Playable {
  return anim.kind === 'group' || anim.kind === 'lagged' ? groupOf(built, anim) : leafOf(built, anim);
}

function textOf(spec: Extract<Mob, { kind: 'text' }> | InlineMob & { kind: 'text' }): Text {
  return new Text(spec.text, {
    fontSize: spec.fontSize, font: fontName(spec.font), weight: spec.weight, anchor: spec.anchor,
    color: spec.color, fillOpacity: spec.fillOpacity,
  });
}

function constructMob(spec: Mob, need: (id: Id) => Mobject, camera: SceneDoc['camera']): Mobject {
  switch (spec.kind) {
    case 'rectangle':
      return new Rectangle({ width: spec.width, height: spec.height, cornerRadius: spec.cornerRadius, ...libStyle(spec.style) });
    case 'square':
      return new Square({ side: spec.side, cornerRadius: spec.cornerRadius, ...libStyle(spec.style) });
    case 'circle':
      return new Circle({ radius: spec.radius, ...libStyle(spec.style) });
    case 'dot':
      return new Dot({ radius: spec.radius, color: spec.color });
    case 'line':
      return new Line(point(spec.start), point(spec.end), libStyle(spec.style));
    case 'polygon':
      return new Polygon(spec.points.map(point), libStyle(spec.style));
    case 'arc':
      return new Arc({ radius: spec.radius, startAngle: spec.startAngle, angle: spec.angle, ...libStyle(spec.style) });
    case 'arcBetween':
      return new ArcBetweenPoints(point(spec.start), point(spec.end), { angle: spec.angle, ...libStyle(spec.style) });
    case 'arrow':
      return new Arrow(point(spec.start), point(spec.end), {
        tipLength: spec.tipLength, tipWidth: spec.tipWidth, buff: spec.buff, stroke: spec.stroke, strokeWidth: spec.strokeWidth,
      });
    case 'curvedArrow':
      return new CurvedArrow(point(spec.start), point(spec.end), {
        angle: spec.angle, tipLength: spec.tipLength, tipWidth: spec.tipWidth, stroke: spec.stroke, strokeWidth: spec.strokeWidth,
      });
    case 'text':
      return textOf(spec);
    case 'decimal':
      return new DecimalNumber(spec.value, {
        decimals: spec.decimals, prefix: spec.prefix, suffix: spec.suffix,
        fontSize: spec.fontSize, font: fontName(spec.font), weight: spec.weight, anchor: spec.anchor,
        color: spec.color, fillOpacity: spec.fillOpacity,
      });
    case 'code':
      return new Code(spec.lines, { fontSize: spec.fontSize, color: spec.color, lineHeight: spec.lineHeight });
    case 'codePanel':
      return new CodePanel(spec.lines, { fontSize: spec.fontSize });
    case 'title':
      return title(spec.text);
    case 'readout':
      return new StateReadout(spec.entries, { fontSize: spec.fontSize, gap: spec.gap });
    case 'group':
      return new Group(...spec.children.map(need));
    case 'labeled':
      return new Labeled(need(spec.shape), need(spec.label), { center: spec.center });
    case 'card': {
      const rows = spec.rows.map((row) => new Text(row, { fontSize: spec.fontSize, color: spec.color, anchor: spec.align === 'center' ? 'middle' : 'start' }));
      return new Card({
        padding: spec.padding, gap: spec.gap, align: spec.align, cornerRadius: spec.cornerRadius,
        stroke: spec.stroke, strokeWidth: spec.strokeWidth, fill: spec.fill, fillOpacity: spec.fillOpacity,
      }).layout(rows);
    }
    case 'flowchart':
      try {
        return flowchart(spec.source, { width: spec.width, height: spec.height, fontSize: spec.fontSize, theme: spec.theme });
      } catch (e) {
        if (e instanceof SceneRejected) throw e;
        return reject(`scene.objects.${spec.id}`, 'flowchart source could not be parsed');
      }
    case 'route':
      return route(need(spec.from), need(spec.to), spec.avoid.map(need), {
        stroke: spec.stroke, strokeWidth: spec.strokeWidth, clearance: spec.clearance, dock: spec.dock,
        bounds: { w: camera.w, h: camera.h },
      });
  }
}

function buildAll(doc: SceneDoc): Built {
  const built: Built = new Map();
  const stack: Id[] = [];
  const need = (id: Id): Mobject => {
    const have = built.get(id);
    if (have) return have;
    if (stack.includes(id)) return reject('scene.objects', 'objects contain a cycle');
    const spec = doc.objects.find((o) => o.id === id);
    if (!spec) return reject('scene.objects', 'unknown object');
    stack.push(id);
    const mob = constructMob(spec, need, doc.camera);
    if (spec.at) mob.moveTo(point(spec.at));
    stack.pop();
    built.set(id, mob);
    return mob;
  };
  for (const o of doc.objects) need(o.id);
  return built;
}

function claimed(doc: SceneDoc): Set<Id> {
  const ids = new Set<Id>();
  for (const o of doc.objects) {
    if (o.kind === 'group') for (const child of o.children) ids.add(child);
    else if (o.kind === 'labeled') { ids.add(o.shape); ids.add(o.label); }
  }
  return ids;
}

function playOpts(play: Extract<Play, { kind: 'play' }>): PlayOpts {
  const opts: PlayOpts = {};
  if (play.runTime !== undefined) opts.runTime = play.runTime;
  if (play.rate !== undefined) opts.rateFunc = rateOf(play.rate);
  if (play.lagRatio !== undefined) opts.lagRatio = play.lagRatio;
  return opts;
}

async function runPlays(scene: Scene, built: Built, doc: SceneDoc): Promise<void> {
  const state: Record<string, string | number | boolean> = Object.create(null);
  for (const [key, value] of doc.state) state[key] = value;
  scene.state = state;
  const roots = claimed(doc);
  for (const o of doc.objects) {
    if (roots.has(o.id)) continue;
    const mob = built.get(o.id);
    if (mob) scene.add(mob);
  }
  for (const step of doc.steps) {
    await scene.step(step.name, step.meta);
    for (const play of step.plays) {
      switch (play.kind) {
        case 'wait':
          await scene.wait(play.seconds);
          break;
        case 'set':
          for (const [key, value] of play.values) state[key] = value;
          break;
        case 'reveal': {
          const stages = asChart(take(built, play.target)).reveal();
          if (stages.length > LIMITS.revealStages) reject(`steps.${step.name}`, `flowchart reveal is limited to ${LIMITS.revealStages} stages`);
          for (const stage of stages) {
            if (stage.length === 0) continue;
            await scene.play(new LaggedStart(stage, { lagRatio: play.lagRatio }), { runTime: play.runTime });
          }
          break;
        }
        case 'play':
          await scene.play(...play.animations.map((anim) => playable(built, anim)), playOpts(play));
          break;
      }
    }
  }
  if (doc.outro > 0) await scene.wait(doc.outro);
}

/** A Scene class for `doc`. Fonts load when the scene runs, as they do for a hand-written scene. */
export function compileScene(doc: SceneDoc): Result<SceneClass> {
  const paths = checkPaths(doc);
  if (!paths.ok) return paths;
  const flows = checkFlows(doc);
  if (!flows.ok) return flows;
  return ok(class RequestScene extends Scene {
    constructor(sink: Sink, opts: SceneOptions = {}) {
      super(sink, { ...opts, fps: doc.fps });
      this.frame = { w: doc.camera.w, h: doc.camera.h };
    }
    override async construct(): Promise<void> {
      await runPlays(this, buildAll(doc), doc);
    }
  });
}
