// Request boundary for a scene sent over HTTP.
//
// JSON is parsed into branded values here. A colour is a palette name or a
// hex literal, a length is a finite number inside a fixed range, and an id is
// a short identifier. Later stages accept only these types, so a request
// string cannot be handed to a serializer as itself.
//
// Lookups use a prototype-free table and Object.hasOwn. JSON objects are read
// with Object.keys / Object.hasOwn, never for-in.

import { Acc, fail, ok } from './result.ts';
import type { Result } from './result.ts';

declare const colorBrand: unique symbol;
declare const noneBrand: unique symbol;
declare const textBrand: unique symbol;
declare const sourceBrand: unique symbol;
declare const numBrand: unique symbol;

/** Canonical `#rrggbb` from the palette or a hex literal. */
export type Color = string & { readonly [colorBrand]: true };
/** The paint value `none`. */
export type NonePaint = 'none' & { readonly [noneBrand]: true };
export type Paint = Color | NonePaint;
/** One line of text: no ASCII controls. */
export type SafeText = string & { readonly [textBrand]: true };
/** Mermaid source: newlines allowed, other ASCII controls rejected. */
export type FlowSource = string & { readonly [sourceBrand]: true };

type Num<Kind extends string> = number & { readonly [numBrand]: Kind };
export type Pixels = Num<'px'>;
export type Fps = Num<'fps'>;
export type Units = Num<'u'>;
export type Coord = Num<'coord'>;
export type Portion = Num<'portion'>;
export type Seconds = Num<'seconds'>;
export type Angle = Num<'angle'>;
export type Factor = Num<'factor'>;
export type Id = string & { readonly [textBrand]: 'id' };

export type Vec = readonly [Coord, Coord];
export type Scalar = SafeText | number | boolean;

export type Style = {
  readonly fill?: Paint;
  readonly fillOpacity?: Portion;
  readonly stroke?: Paint;
  readonly strokeWidth?: Units;
  readonly strokeOpacity?: Portion;
  readonly opacity?: Portion;
};

export type RateName =
  | 'linear' | 'smooth' | 'rushInto' | 'rushFrom' | 'thereAndBack'
  | 'easeInQuad' | 'easeOutQuad' | 'easeOutBack' | 'wiggle';

export type AnimOpts = {
  readonly runTime?: Seconds;
  readonly rate?: RateName;
  readonly lagRatio?: Portion;
  readonly remover?: boolean;
};

type Leaf =
  | { readonly kind: 'fadeIn'; readonly target: Id; readonly shift: Vec | null; readonly scale: Factor } & AnimOpts
  | { readonly kind: 'fadeOut'; readonly target: Id; readonly shift: Vec | null; readonly scale: Factor } & AnimOpts
  | { readonly kind: 'create'; readonly target: Id } & AnimOpts
  | { readonly kind: 'write'; readonly target: Id } & AnimOpts
  | { readonly kind: 'indicate'; readonly target: Id; readonly color: Color; readonly scaleFactor: Factor } & AnimOpts
  | { readonly kind: 'flash'; readonly target: Id } & AnimOpts
  | { readonly kind: 'transform'; readonly target: Id; readonly to: InlineMob; readonly replace: boolean } & AnimOpts
  | { readonly kind: 'moveAlong'; readonly target: Id; readonly path: Id; readonly fromCurrent: boolean } & AnimOpts
  | { readonly kind: 'animate'; readonly target: Id; readonly calls: readonly AnimateCall[] } & AnimOpts
  | { readonly kind: 'focus'; readonly target: Id; readonly line: number; readonly color: Color } & AnimOpts
  | { readonly kind: 'unfocus'; readonly target: Id } & AnimOpts;

export type Anim =
  | Leaf
  | { readonly kind: 'group'; readonly animations: readonly Leaf[]; readonly lagRatio: Portion; readonly runTime?: Seconds; readonly rate?: RateName }
  | { readonly kind: 'lagged'; readonly animations: readonly Leaf[]; readonly lagRatio: Portion; readonly runTime?: Seconds; readonly rate?: RateName };

export type AnimateCall =
  | { readonly method: 'shift'; readonly by: Vec }
  | { readonly method: 'moveTo'; readonly at: Vec }
  | { readonly method: 'scale'; readonly factor: Factor }
  | { readonly method: 'rotate'; readonly angle: Angle }
  | { readonly method: 'setFill'; readonly fill: Color; readonly fillOpacity: Portion | null }
  | { readonly method: 'setStroke'; readonly stroke: Paint; readonly strokeWidth: Units | null; readonly strokeOpacity: Portion | null }
  | { readonly method: 'setOpacity'; readonly opacity: Portion };

/** A mob used only as a Transform target. It is not added to the scene. */
export type InlineMob =
  | { readonly kind: 'rectangle'; readonly width: Units; readonly height: Units; readonly cornerRadius: Units; readonly style: Style }
  | { readonly kind: 'square'; readonly side: Units; readonly cornerRadius: Units; readonly style: Style }
  | { readonly kind: 'circle'; readonly radius: Units; readonly style: Style }
  | { readonly kind: 'dot'; readonly radius: Units; readonly color: Color }
  | { readonly kind: 'text'; readonly text: SafeText; readonly fontSize: Units; readonly font: 'sans' | 'mono'; readonly weight: 'normal' | 'bold'; readonly anchor: 'start' | 'middle' | 'end'; readonly color: Color; readonly fillOpacity: Portion };

export type Mob = { readonly id: Id; readonly at: Vec | null } & (
  | { readonly kind: 'rectangle'; readonly width: Units; readonly height: Units; readonly cornerRadius: Units; readonly style: Style }
  | { readonly kind: 'square'; readonly side: Units; readonly cornerRadius: Units; readonly style: Style }
  | { readonly kind: 'circle'; readonly radius: Units; readonly style: Style }
  | { readonly kind: 'dot'; readonly radius: Units; readonly color: Color }
  | { readonly kind: 'line'; readonly start: Vec; readonly end: Vec; readonly style: Style }
  | { readonly kind: 'polygon'; readonly points: readonly Vec[]; readonly style: Style }
  | { readonly kind: 'arc'; readonly radius: Units; readonly startAngle: Angle; readonly angle: Angle; readonly style: Style }
  | { readonly kind: 'arcBetween'; readonly start: Vec; readonly end: Vec; readonly angle: Angle; readonly style: Style }
  | { readonly kind: 'arrow'; readonly start: Vec; readonly end: Vec; readonly tipLength: Units; readonly tipWidth: Units; readonly buff: Units; readonly stroke: Paint; readonly strokeWidth: Units }
  | { readonly kind: 'curvedArrow'; readonly start: Vec; readonly end: Vec; readonly angle: Angle; readonly tipLength: Units; readonly tipWidth: Units; readonly stroke: Paint; readonly strokeWidth: Units }
  | { readonly kind: 'text'; readonly text: SafeText; readonly fontSize: Units; readonly font: 'sans' | 'mono'; readonly weight: 'normal' | 'bold'; readonly anchor: 'start' | 'middle' | 'end'; readonly color: Color; readonly fillOpacity: Portion }
  | { readonly kind: 'decimal'; readonly value: number; readonly decimals: number; readonly prefix: SafeText; readonly suffix: SafeText; readonly fontSize: Units; readonly font: 'sans' | 'mono'; readonly weight: 'normal' | 'bold'; readonly anchor: 'start' | 'middle' | 'end'; readonly color: Color; readonly fillOpacity: Portion }
  | { readonly kind: 'code'; readonly lines: readonly SafeText[]; readonly fontSize: Units; readonly color: Color; readonly lineHeight: Factor }
  | { readonly kind: 'codePanel'; readonly lines: readonly SafeText[]; readonly fontSize: Units }
  | { readonly kind: 'title'; readonly text: SafeText }
  | { readonly kind: 'readout'; readonly entries: readonly (readonly [SafeText, Scalar])[]; readonly fontSize: Units; readonly gap: Units }
  | { readonly kind: 'group'; readonly children: readonly Id[] }
  | { readonly kind: 'labeled'; readonly shape: Id; readonly label: Id; readonly center: boolean }
  | { readonly kind: 'card'; readonly rows: readonly SafeText[]; readonly padding: Units; readonly gap: Units; readonly align: 'start' | 'center'; readonly cornerRadius: Units; readonly stroke: Paint; readonly strokeWidth: Units; readonly fill: Paint; readonly fillOpacity: Portion; readonly fontSize: Units; readonly color: Color }
  | { readonly kind: 'flowchart'; readonly source: FlowSource; readonly width: Units; readonly height: Units; readonly fontSize: Units; readonly theme: FlowTheme }
  | { readonly kind: 'route'; readonly from: Id; readonly to: Id; readonly avoid: readonly Id[]; readonly stroke: Paint; readonly strokeWidth: Units; readonly clearance: Units; readonly dock: 'auto' | 'side' | 'facing' }
);

export type FlowTheme = {
  readonly node: { readonly stroke: Color; readonly fill: Color; readonly fillOpacity: Portion; readonly color: Color; readonly strokeWidth: Units };
  readonly cluster: { readonly stroke: Color; readonly fill: Color; readonly fillOpacity: Portion; readonly color: Color; readonly strokeWidth: Units };
  readonly edge: { readonly stroke: Color; readonly color: Color; readonly strokeWidth: Units };
  readonly labelBg: Color;
};

export type Play =
  | { readonly kind: 'wait'; readonly seconds: Seconds }
  | { readonly kind: 'set'; readonly values: readonly (readonly [Id, Scalar])[] }
  | { readonly kind: 'reveal'; readonly target: Id; readonly runTime: Seconds; readonly lagRatio: Portion }
  | { readonly kind: 'play'; readonly animations: readonly Anim[]; readonly runTime?: Seconds; readonly rate?: RateName; readonly lagRatio?: Portion };

export type Step = {
  readonly name: Id;
  readonly meta: Readonly<Record<string, Scalar>>;
  readonly plays: readonly Play[];
};

export type Select =
  | { readonly kind: 'end' }
  | { readonly kind: 'time'; readonly t: Seconds }
  | { readonly kind: 'step'; readonly name: string };

export type Output =
  | { readonly format: 'svg'; readonly select: Select; readonly width: Pixels; readonly background: Color }
  | { readonly format: 'frames'; readonly width: Pixels; readonly background: Color }
  | { readonly format: 'text'; readonly select: Select }
  | { readonly format: 'elements'; readonly select: Select }
  | { readonly format: 'trace' }
  | { readonly format: 'index' };

export type SceneDoc = {
  readonly camera: { readonly w: Units; readonly h: Units };
  readonly fps: Fps;
  readonly outro: Seconds;
  readonly state: readonly (readonly [Id, Scalar])[];
  readonly objects: readonly Mob[];
  readonly steps: readonly Step[];
};

export type Envelope = { readonly scene: SceneDoc; readonly output: Output };

export const LIMITS = {
  bodyBytes: 65536,
  objects: 40,
  steps: 24,
  playsPerStep: 12,
  animsPerPlay: 8,
  calls: 8,
  text: 160,
  lines: 24,
  line: 80,
  points: 16,
  children: 12,
  rows: 8,
  entries: 8,
  stateKeys: 12,
  metaKeys: 8,
  metaText: 80,
  flow: 1200,
  prefix: 12,
  fpsMin: 1,
  fpsMax: 20,
  maxFrames: 180,
  framesFormat: 40,
  /** A flowchart reveal is played one stage at a time, and each stage counts toward the frame cap. */
  revealStages: 8,
  runMin: 0.05,
  runMax: 4,
  pxMin: 32,
  pxMax: 1280,
  coord: 24,
  sizeMin: 0.02,
  sizeMax: 24,
  cameraMin: 1,
  cameraMax: 32,
} as const;

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const PALETTE: Record<string, string> = Object.create(null);
for (const [name, hex] of [
  ['white', '#ffffff'], ['black', '#000000'], ['grey', '#888888'], ['grey_d', '#444444'],
  ['blue', '#58c4dd'], ['blue_d', '#29abca'], ['teal', '#5cd0b3'], ['green', '#83c167'],
  ['yellow', '#ffff00'], ['gold', '#f0ac5f'], ['red', '#fc6255'], ['maroon', '#c55f73'],
  ['purple', '#9a72ac'], ['orange', '#ff862f'],
] as const) PALETTE[name] = hex;

const RATES = new Set<RateName>(['linear', 'smooth', 'rushInto', 'rushFrom', 'thereAndBack', 'easeInQuad', 'easeOutQuad', 'easeOutBack', 'wiggle']);

const asNum = <K extends string>(n: number): Num<K> => n as Num<K>;
const asText = (s: string): SafeText => s as SafeText;
const asId = (s: string): Id => s as Id;

function canonical(hex: string): Color {
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return ('#' + full.toLowerCase()) as Color;
}

export function parseColor(input: unknown, path: string): Result<Color> {
  if (typeof input !== 'string') return fail(path, 'expected a palette name or #rgb/#rrggbb');
  if (Object.hasOwn(PALETTE, input)) return ok(canonical(PALETTE[input]!));
  if (/^#[0-9a-fA-F]{3}$/.test(input) || /^#[0-9a-fA-F]{6}$/.test(input)) return ok(canonical(input));
  return fail(path, 'expected a palette name or #rgb/#rrggbb');
}

export function parsePaint(input: unknown, path: string): Result<Paint> {
  if (input === 'none') return ok('none' as NonePaint);
  return parseColor(input, path);
}

function finite(input: unknown, path: string): Result<number> {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fail(path, 'expected a finite number');
  return ok(input);
}

function ranged<K extends string>(input: unknown, path: string, lo: number, hi: number, kind: K, what: string): Result<Num<K>> {
  const n = finite(input, path);
  if (!n.ok) return n;
  if (n.value < lo || n.value > hi) return fail(path, `${what} must be from ${lo} to ${hi}`);
  return ok(asNum<K>(n.value));
}

const parseCoord = (v: unknown, p: string): Result<Coord> => ranged(v, p, -LIMITS.coord, LIMITS.coord, 'coord', 'a coordinate');
const parseSize = (v: unknown, p: string): Result<Units> => ranged(v, p, LIMITS.sizeMin, LIMITS.sizeMax, 'u', 'a length');
const parseNonNeg = (v: unknown, p: string): Result<Units> => ranged(v, p, 0, LIMITS.sizeMax, 'u', 'a length');
const parsePortion = (v: unknown, p: string): Result<Portion> => ranged(v, p, 0, 1, 'portion', 'a portion');
const parseSeconds = (v: unknown, p: string, lo: number = LIMITS.runMin): Result<Seconds> => ranged(v, p, lo, LIMITS.runMax, 'seconds', 'seconds');
const parseAngle = (v: unknown, p: string): Result<Angle> => ranged(v, p, -12, 12, 'angle', 'an angle in radians');
const parseTurn = (v: unknown, p: string): Result<Angle> => ranged(v, p, 0.2, 2.8, 'angle', 'a turn in radians');
const parseFactor = (v: unknown, p: string, lo: number, hi: number): Result<Factor> => ranged(v, p, lo, hi, 'factor', 'a factor');

export function parsePixels(input: unknown, path: string): Result<Pixels> {
  const n = finite(input, path);
  if (!n.ok) return n;
  if (!Number.isInteger(n.value) || n.value < LIMITS.pxMin || n.value > LIMITS.pxMax) {
    return fail(path, `width must be an integer from ${LIMITS.pxMin} to ${LIMITS.pxMax}`);
  }
  return ok(asNum<'px'>(n.value));
}

function parseFps(input: unknown, path: string): Result<Fps> {
  const n = finite(input, path);
  if (!n.ok) return n;
  if (!Number.isInteger(n.value) || n.value < LIMITS.fpsMin || n.value > LIMITS.fpsMax) {
    return fail(path, `fps must be an integer from ${LIMITS.fpsMin} to ${LIMITS.fpsMax}`);
  }
  return ok(asNum<'fps'>(n.value));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A short identifier is safe to repeat in an error; anything else is not. */
function shownToken(value: string): string | null {
  return ID.test(value) ? value : null;
}

function fields(input: unknown, path: string, allowed: readonly string[]): Result<Record<string, unknown>> {
  if (!isRecord(input)) return fail(path, 'expected an object');
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      const token = shownToken(key);
      return fail(path, token ? `unknown field ${token}` : 'unknown field');
    }
  }
  return ok(input);
}

function has(o: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(o, key);
}

function parseId(input: unknown, path: string): Result<Id> {
  if (typeof input !== 'string' || !ID.test(input)) return fail(path, 'expected an identifier (letter, then letters, digits, _ or -)');
  return ok(asId(input));
}

function parseSafe(input: unknown, path: string, max: number): Result<SafeText> {
  if (typeof input !== 'string') return fail(path, 'expected a string');
  if (input.length > max) return fail(path, `string exceeds ${max} characters`);
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 32 || c === 127) return fail(path, 'string contains a control character');
  }
  return ok(asText(input));
}

function parseVec(input: unknown, path: string): Result<Vec> {
  if (!Array.isArray(input) || input.length !== 2) return fail(path, 'expected [x, y]');
  const acc = new Acc();
  let x: Coord = asNum(0), y: Coord = asNum(0);
  acc.add(parseCoord(input[0], `${path}[0]`), (v) => { x = v; });
  acc.add(parseCoord(input[1], `${path}[1]`), (v) => { y = v; });
  return acc.done([x, y]);
}

function parseStyle(input: unknown, path: string): Result<Style> {
  const rec = fields(input, path, ['fill', 'fillOpacity', 'stroke', 'strokeWidth', 'strokeOpacity', 'opacity']);
  if (!rec.ok) return rec;
  const o = rec.value;
  const acc = new Acc();
  const style: { -readonly [K in keyof Style]?: Style[K] } = {};
  if (has(o, 'fill')) acc.add(parsePaint(o.fill, `${path}.fill`), (v) => { style.fill = v; });
  if (has(o, 'fillOpacity')) acc.add(parsePortion(o.fillOpacity, `${path}.fillOpacity`), (v) => { style.fillOpacity = v; });
  if (has(o, 'stroke')) acc.add(parsePaint(o.stroke, `${path}.stroke`), (v) => { style.stroke = v; });
  if (has(o, 'strokeWidth')) acc.add(parseNonNeg(o.strokeWidth, `${path}.strokeWidth`), (v) => { style.strokeWidth = v; });
  if (has(o, 'strokeOpacity')) acc.add(parsePortion(o.strokeOpacity, `${path}.strokeOpacity`), (v) => { style.strokeOpacity = v; });
  if (has(o, 'opacity')) acc.add(parsePortion(o.opacity, `${path}.opacity`), (v) => { style.opacity = v; });
  return acc.done(style);
}

const EMPTY: Style = {};

function opt<T>(o: Record<string, unknown>, key: string, path: string, parse: (v: unknown, p: string) => Result<T>, fallback: T): Result<T> {
  if (!has(o, key)) return ok(fallback);
  return parse(o[key], `${path}.${key}`);
}

function parseScalar(input: unknown, path: string): Result<Scalar> {
  if (typeof input === 'boolean') return ok(input);
  if (typeof input === 'number') {
    const n = finite(input, path);
    if (!n.ok) return n;
    if (Math.abs(n.value) > 1e9) return fail(path, 'number is out of range');
    return ok(n.value);
  }
  return parseSafe(input, path, LIMITS.metaText);
}

function parseAnimOpts(o: Record<string, unknown>, path: string, acc: Acc): AnimOpts {
  const out: { -readonly [K in keyof AnimOpts]?: AnimOpts[K] } = {};
  if (has(o, 'runTime')) acc.add(parseSeconds(o.runTime, `${path}.runTime`), (v) => { out.runTime = v; });
  if (has(o, 'rate')) acc.add(parseRate(o.rate, `${path}.rate`), (v) => { out.rate = v; });
  if (has(o, 'lagRatio')) acc.add(parsePortion(o.lagRatio, `${path}.lagRatio`), (v) => { out.lagRatio = v; });
  if (has(o, 'remover')) {
    if (typeof o.remover !== 'boolean') acc.add(fail(`${path}.remover`, 'expected a boolean'), () => {});
    else out.remover = o.remover;
  }
  return out;
}

function parseRate(input: unknown, path: string): Result<RateName> {
  if (typeof input !== 'string' || !RATES.has(input as RateName)) return fail(path, 'unknown rate');
  return ok(input as RateName);
}

const OPT_KEYS = ['runTime', 'rate', 'lagRatio', 'remover'];

function parseLeaf(input: unknown, path: string): Result<Leaf> {
  if (!isRecord(input) || typeof input.kind !== 'string') return fail(path, 'expected an animation');
  const kind = input.kind;
  const common = ['kind', 'target', ...OPT_KEYS];
  const table: Record<string, readonly string[]> = {
    fadeIn: [...common, 'shift', 'scale'],
    fadeOut: [...common, 'shift', 'scale'],
    create: common,
    write: common,
    indicate: [...common, 'color', 'scaleFactor'],
    flash: common,
    transform: [...common, 'to', 'replace'],
    moveAlong: [...common, 'path', 'fromCurrent'],
    animate: [...common, 'calls'],
    focus: [...common, 'line', 'color'],
    unfocus: common,
  };
  const allowed = Object.hasOwn(table, kind) ? table[kind] : undefined;
  if (!allowed) {
    const token = shownToken(kind);
    return fail(path, token ? `unknown animation ${token}` : 'unknown animation');
  }
  const rec = fields(input, path, allowed);
  if (!rec.ok) return rec;
  const o = rec.value;
  const acc = new Acc();
  let target: Id = asId('a');
  acc.add(parseId(o.target, `${path}.target`), (v) => { target = v; });
  const opts = parseAnimOpts(o, path, acc);
  if (kind === 'fadeIn' || kind === 'fadeOut') {
    let shift: Vec | null = null, scale: Factor = asNum<'factor'>(1);
    if (has(o, 'shift') && o.shift !== null) acc.add(parseVec(o.shift, `${path}.shift`), (v) => { shift = v; });
    acc.add(opt(o, 'scale', path, (v, p) => parseFactor(v, p, 0.05, 8), asNum<'factor'>(1)), (v) => { scale = v; });
    return acc.done({ kind, target, shift, scale, ...opts });
  }
  if (kind === 'create' || kind === 'write' || kind === 'flash' || kind === 'unfocus') {
    return acc.done({ kind, target, ...opts });
  }
  if (kind === 'indicate') {
    let color: Color = defaultColor, scaleFactor: Factor = asNum<'factor'>(1.2);
    acc.add(opt(o, 'color', path, parseColor, defaultColor), (v) => { color = v; });
    acc.add(opt(o, 'scaleFactor', path, (v, p) => parseFactor(v, p, 1, 3), asNum<'factor'>(1.2)), (v) => { scaleFactor = v; });
    return acc.done({ kind, target, color, scaleFactor, ...opts });
  }
  if (kind === 'transform') {
    let to: InlineMob = { kind: 'circle', radius: asNum(1), style: EMPTY };
    let replace = false;
    acc.add(parseInline(o.to, `${path}.to`), (v) => { to = v; });
    if (has(o, 'replace')) {
      if (typeof o.replace !== 'boolean') acc.add(fail(`${path}.replace`, 'expected a boolean'), () => {});
      else replace = o.replace;
    }
    return acc.done({ kind, target, to, replace, ...opts });
  }
  if (kind === 'moveAlong') {
    let pathId: Id = asId('a');
    let fromCurrent = true;
    acc.add(parseId(o.path, `${path}.path`), (v) => { pathId = v; });
    if (has(o, 'fromCurrent')) {
      if (typeof o.fromCurrent !== 'boolean') acc.add(fail(`${path}.fromCurrent`, 'expected a boolean'), () => {});
      else fromCurrent = o.fromCurrent;
    }
    return acc.done({ kind: 'moveAlong', target, path: pathId, fromCurrent, ...opts });
  }
  if (kind === 'animate') {
    let calls: readonly AnimateCall[] = [];
    acc.add(parseCalls(o.calls, `${path}.calls`), (v) => { calls = v; });
    return acc.done({ kind, target, calls, ...opts });
  }
  let line = 0;
  let color: Color = defaultColor;
  acc.add(finite(o.line, `${path}.line`), (v) => {
    if (!Number.isInteger(v) || v < 0 || v > 64) acc.add(fail(`${path}.line`, 'line must be an integer from 0 to 64'), () => {});
    else line = v;
  });
  acc.add(opt(o, 'color', path, parseColor, defaultColor), (v) => { color = v; });
  return acc.done({ kind: 'focus', target, line, color, ...opts });
}

function parseCalls(input: unknown, path: string): Result<readonly AnimateCall[]> {
  if (!Array.isArray(input) || input.length < 1 || input.length > LIMITS.calls) return fail(path, `expected 1 to ${LIMITS.calls} calls`);
  const acc = new Acc();
  const calls: AnimateCall[] = [];
  input.forEach((item, i) => acc.add(parseCall(item, `${path}[${i}]`), (v) => calls.push(v)));
  return acc.done(calls);
}

function parseCall(input: unknown, path: string): Result<AnimateCall> {
  if (!isRecord(input) || typeof input.method !== 'string') return fail(path, 'expected a call');
  const method = input.method;
  const allowed: Record<string, readonly string[]> = {
    shift: ['method', 'by'], moveTo: ['method', 'at'], scale: ['method', 'factor'], rotate: ['method', 'angle'],
    setFill: ['method', 'fill', 'fillOpacity'], setStroke: ['method', 'stroke', 'strokeWidth', 'strokeOpacity'],
    setOpacity: ['method', 'opacity'],
  };
  const keys = Object.hasOwn(allowed, method) ? allowed[method] : undefined;
  if (!keys) {
    const token = shownToken(method);
    return fail(path, token ? `unknown call ${token}` : 'unknown call');
  }
  const rec = fields(input, path, keys);
  if (!rec.ok) return rec;
  const o = rec.value;
  const acc = new Acc();
  if (method === 'shift') {
    let by: Vec = [asNum(0), asNum(0)];
    acc.add(parseVec(o.by, `${path}.by`), (v) => { by = v; });
    return acc.done({ method, by });
  }
  if (method === 'moveTo') {
    let at: Vec = [asNum(0), asNum(0)];
    acc.add(parseVec(o.at, `${path}.at`), (v) => { at = v; });
    return acc.done({ method, at });
  }
  if (method === 'scale') {
    let factor: Factor = asNum(1);
    acc.add(parseFactor(o.factor, `${path}.factor`, 0.05, 8), (v) => { factor = v; });
    return acc.done({ method, factor });
  }
  if (method === 'rotate') {
    let angle: Angle = asNum(0);
    acc.add(parseAngle(o.angle, `${path}.angle`), (v) => { angle = v; });
    return acc.done({ method, angle });
  }
  if (method === 'setFill') {
    let fill: Color = defaultColor, fillOpacity: Portion | null = null;
    acc.add(parseColor(o.fill, `${path}.fill`), (v) => { fill = v; });
    if (has(o, 'fillOpacity')) acc.add(parsePortion(o.fillOpacity, `${path}.fillOpacity`), (v) => { fillOpacity = v; });
    return acc.done({ method, fill, fillOpacity });
  }
  if (method === 'setStroke') {
    let stroke: Paint = defaultColor, strokeWidth: Units | null = null, strokeOpacity: Portion | null = null;
    acc.add(parsePaint(o.stroke, `${path}.stroke`), (v) => { stroke = v; });
    if (has(o, 'strokeWidth')) acc.add(parseNonNeg(o.strokeWidth, `${path}.strokeWidth`), (v) => { strokeWidth = v; });
    if (has(o, 'strokeOpacity')) acc.add(parsePortion(o.strokeOpacity, `${path}.strokeOpacity`), (v) => { strokeOpacity = v; });
    return acc.done({ method, stroke, strokeWidth, strokeOpacity });
  }
  let opacity: Portion = asNum(1);
  acc.add(parsePortion(o.opacity, `${path}.opacity`), (v) => { opacity = v; });
  return acc.done({ method: 'setOpacity', opacity });
}

function parseInline(input: unknown, path: string): Result<InlineMob> {
  if (!isRecord(input) || typeof input.kind !== 'string') return fail(path, 'expected a shape');
  if (input.kind === 'rectangle') return parseInlineRect(input, path);
  if (input.kind === 'square') return parseInlineSquare(input, path);
  if (input.kind === 'circle') return parseInlineCircle(input, path);
  if (input.kind === 'dot') return parseInlineDot(input, path);
  if (input.kind === 'text') return parseInlineText(input, path);
  return fail(path, 'a transform target must be a rectangle, square, circle, dot, or text');
}

function parseInlineRect(o: Record<string, unknown>, path: string): Result<InlineMob> {
  const rec = fields(o, path, ['kind', 'width', 'height', 'cornerRadius', 'style']);
  if (!rec.ok) return rec;
  const acc = new Acc();
  let width: Units = asNum(4), height: Units = asNum(2), cornerRadius: Units = asNum(0), style: Style = EMPTY;
  acc.add(opt(o, 'width', path, parseSize, asNum(4)), (v) => { width = v; });
  acc.add(opt(o, 'height', path, parseSize, asNum(2)), (v) => { height = v; });
  acc.add(opt(o, 'cornerRadius', path, parseNonNeg, asNum(0)), (v) => { cornerRadius = v; });
  acc.add(opt(o, 'style', path, parseStyle, EMPTY), (v) => { style = v; });
  return acc.done({ kind: 'rectangle', width, height, cornerRadius, style });
}

function parseInlineSquare(o: Record<string, unknown>, path: string): Result<InlineMob> {
  const rec = fields(o, path, ['kind', 'side', 'cornerRadius', 'style']);
  if (!rec.ok) return rec;
  const acc = new Acc();
  let side: Units = asNum(2), cornerRadius: Units = asNum(0), style: Style = EMPTY;
  acc.add(opt(o, 'side', path, parseSize, asNum(2)), (v) => { side = v; });
  acc.add(opt(o, 'cornerRadius', path, parseNonNeg, asNum(0)), (v) => { cornerRadius = v; });
  acc.add(opt(o, 'style', path, parseStyle, EMPTY), (v) => { style = v; });
  return acc.done({ kind: 'square', side, cornerRadius, style });
}

function parseInlineCircle(o: Record<string, unknown>, path: string): Result<InlineMob> {
  const rec = fields(o, path, ['kind', 'radius', 'style']);
  if (!rec.ok) return rec;
  const acc = new Acc();
  let radius: Units = asNum(1), style: Style = EMPTY;
  acc.add(opt(o, 'radius', path, parseSize, asNum(1)), (v) => { radius = v; });
  acc.add(opt(o, 'style', path, parseStyle, EMPTY), (v) => { style = v; });
  return acc.done({ kind: 'circle', radius, style });
}

function parseInlineDot(o: Record<string, unknown>, path: string): Result<InlineMob> {
  const rec = fields(o, path, ['kind', 'radius', 'color']);
  if (!rec.ok) return rec;
  const acc = new Acc();
  let radius: Units = asNum(0.08), color: Color = defaultColor;
  acc.add(opt(o, 'radius', path, parseSize, asNum(0.08)), (v) => { radius = v; });
  acc.add(opt(o, 'color', path, parseColor, defaultColor), (v) => { color = v; });
  return acc.done({ kind: 'dot', radius, color });
}

function parseInlineText(o: Record<string, unknown>, path: string): Result<InlineMob> {
  const rec = fields(o, path, ['kind', 'text', 'fontSize', 'font', 'weight', 'anchor', 'color', 'fillOpacity']);
  if (!rec.ok) return rec;
  const acc = new Acc();
  const text = blankText();
  acc.add(parseSafe(o.text, `${path}.text`, LIMITS.text), (v) => { text.text = v; });
  acc.add(parseTextOpts(o, path), (v) => Object.assign(text, v));
  return acc.done({ kind: 'text', ...text });
}

type TextOptsParsed = { text: SafeText; fontSize: Units; font: 'sans' | 'mono'; weight: 'normal' | 'bold'; anchor: 'start' | 'middle' | 'end'; color: Color; fillOpacity: Portion };

function blankText(): TextOptsParsed {
  return { text: asText(''), fontSize: asNum(0.4), font: 'sans', weight: 'normal', anchor: 'middle', color: defaultColor, fillOpacity: asNum(1) };
}

function parseTextOpts(o: Record<string, unknown>, path: string): Result<Omit<TextOptsParsed, 'text'>> {
  const acc = new Acc();
  let fontSize: Units = asNum(0.4), font: 'sans' | 'mono' = 'sans', weight: 'normal' | 'bold' = 'normal';
  let anchor: 'start' | 'middle' | 'end' = 'middle', color: Color = defaultColor, fillOpacity: Portion = asNum(1);
  acc.add(opt(o, 'fontSize', path, parseSize, asNum(0.4)), (v) => { fontSize = v; });
  if (has(o, 'font')) {
    if (o.font !== 'sans' && o.font !== 'mono') acc.add(fail(`${path}.font`, "font must be 'sans' or 'mono'"), () => {});
    else font = o.font;
  }
  if (has(o, 'weight')) {
    if (o.weight !== 'normal' && o.weight !== 'bold') acc.add(fail(`${path}.weight`, "weight must be 'normal' or 'bold'"), () => {});
    else weight = o.weight;
  }
  if (has(o, 'anchor')) {
    if (o.anchor !== 'start' && o.anchor !== 'middle' && o.anchor !== 'end') acc.add(fail(`${path}.anchor`, "anchor must be 'start', 'middle', or 'end'"), () => {});
    else anchor = o.anchor;
  }
  acc.add(opt(o, 'color', path, parseColor, defaultColor), (v) => { color = v; });
  acc.add(opt(o, 'fillOpacity', path, parsePortion, asNum(1)), (v) => { fillOpacity = v; });
  return acc.done({ fontSize, font, weight, anchor, color, fillOpacity });
}

function parseAnim(input: unknown, path: string): Result<Anim> {
  if (!isRecord(input)) return fail(path, 'expected an animation');
  if (input.kind === 'group' || input.kind === 'lagged') return parseGroupAnim(input, path, input.kind);
  return parseLeaf(input, path);
}

function parseGroupAnim(o: Record<string, unknown>, path: string, kind: 'group' | 'lagged'): Result<Anim> {
  const rec = fields(o, path, ['kind', 'animations', 'lagRatio', 'runTime', 'rate']);
  if (!rec.ok) return rec;
  if (!Array.isArray(o.animations) || o.animations.length < 1 || o.animations.length > LIMITS.animsPerPlay) {
    return fail(`${path}.animations`, `expected 1 to ${LIMITS.animsPerPlay} animations`);
  }
  const acc = new Acc();
  const animations: Leaf[] = [];
  o.animations.forEach((item, i) => {
    acc.add(parseLeaf(item, `${path}.animations[${i}]`), (v) => animations.push(v));
  });
  let lagRatio: Portion = asNum(kind === 'lagged' ? 0.2 : 0);
  const opts: { runTime?: Seconds; rate?: RateName } = {};
  acc.add(opt(o, 'lagRatio', path, parsePortion, lagRatio), (v) => { lagRatio = v; });
  if (has(o, 'runTime')) acc.add(parseSeconds(o.runTime, `${path}.runTime`), (v) => { opts.runTime = v; });
  if (has(o, 'rate')) acc.add(parseRate(o.rate, `${path}.rate`), (v) => { opts.rate = v; });
  return acc.done({ kind, animations, lagRatio, ...opts });
}

const defaultColor: Color = canonical('#ffffff');
const defaultBg: Color = canonical('#1a1a1a');

export const DEFAULT_WIDTH: Pixels = asNum<'px'>(1280);
export const DEFAULT_BACKGROUND: Color = defaultBg;

export function parseSvgPair(width: unknown, background: unknown, widthPath: string, bgPath: string): Result<{ readonly width: Pixels; readonly background: Color }> {
  const acc = new Acc();
  let w = DEFAULT_WIDTH, bg = DEFAULT_BACKGROUND;
  acc.add(width === undefined ? ok(DEFAULT_WIDTH) : parsePixels(width, widthPath), (v) => { w = v; });
  acc.add(background === undefined ? ok(DEFAULT_BACKGROUND) : parseColor(background, bgPath), (v) => { bg = v; });
  return acc.done({ width: w, background: bg });
}

function parseSelect(input: unknown, path: string): Result<Select> {
  if (input === undefined) return ok({ kind: 'end' });
  const rec = fields(input, path, ['kind', 't', 'name']);
  if (!rec.ok) return rec;
  const o = rec.value;
  if (o.kind === 'end') return ok({ kind: 'end' });
  if (o.kind === 'time') {
    const t = parseSeconds(o.t, `${path}.t`, 0);
    return t.ok ? ok({ kind: 'time', t: t.value }) : t;
  }
  if (o.kind === 'step') {
    if (typeof o.name !== 'string' || o.name.length < 1 || o.name.length > 64) return fail(`${path}.name`, 'expected a step name');
    if (/[\u0000-\u001f\u007f]/.test(o.name)) return fail(`${path}.name`, 'step name contains a control character');
    return ok({ kind: 'step', name: o.name });
  }
  return fail(path, "select.kind must be 'end', 'time', or 'step'");
}

function parseOutput(input: unknown, path: string): Result<Output> {
  const rec = fields(input, path, ['format', 'select', 'width', 'background']);
  if (!rec.ok) return rec;
  const o = rec.value;
  const format = o.format;
  if (format !== 'svg' && format !== 'frames' && format !== 'text' && format !== 'elements' && format !== 'trace' && format !== 'index') {
    return fail(`${path}.format`, "format must be svg, frames, text, elements, trace, or index");
  }
  const paints = format === 'svg' || format === 'frames';
  if (!paints && (has(o, 'width') || has(o, 'background'))) return fail(path, 'width and background belong on svg or frames output');
  if ((format === 'trace' || format === 'index' || format === 'frames') && has(o, 'select')) return fail(path, 'this format describes the whole scene and takes no select');
  const acc = new Acc();
  let select: Select = { kind: 'end' };
  let width = DEFAULT_WIDTH, background = DEFAULT_BACKGROUND;
  if (format === 'svg' || format === 'text' || format === 'elements') {
    acc.add(has(o, 'select') ? parseSelect(o.select, `${path}.select`) : ok<Select>({ kind: 'end' }), (v) => { select = v; });
  }
  if (paints) {
    acc.add(has(o, 'width') ? parsePixels(o.width, `${path}.width`) : ok(DEFAULT_WIDTH), (v) => { width = v; });
    acc.add(has(o, 'background') ? parseColor(o.background, `${path}.background`) : ok(DEFAULT_BACKGROUND), (v) => { background = v; });
  }
  if (format === 'svg') return acc.done({ format, select, width, background });
  if (format === 'frames') return acc.done({ format, width, background });
  if (format === 'text') return acc.done({ format, select });
  if (format === 'elements') return acc.done({ format, select });
  if (format === 'trace') return acc.done({ format });
  return acc.done({ format: 'index' });
}

const MOB_KEYS: Record<string, readonly string[]> = {
  rectangle: ['id', 'kind', 'at', 'width', 'height', 'cornerRadius', 'style'],
  square: ['id', 'kind', 'at', 'side', 'cornerRadius', 'style'],
  circle: ['id', 'kind', 'at', 'radius', 'style'],
  dot: ['id', 'kind', 'at', 'radius', 'color'],
  line: ['id', 'kind', 'at', 'start', 'end', 'style'],
  polygon: ['id', 'kind', 'at', 'points', 'style'],
  arc: ['id', 'kind', 'at', 'radius', 'startAngle', 'angle', 'style'],
  arcBetween: ['id', 'kind', 'at', 'start', 'end', 'angle', 'style'],
  arrow: ['id', 'kind', 'at', 'start', 'end', 'tipLength', 'tipWidth', 'buff', 'stroke', 'strokeWidth'],
  curvedArrow: ['id', 'kind', 'at', 'start', 'end', 'angle', 'tipLength', 'tipWidth', 'stroke', 'strokeWidth'],
  text: ['id', 'kind', 'at', 'text', 'fontSize', 'font', 'weight', 'anchor', 'color', 'fillOpacity'],
  decimal: ['id', 'kind', 'at', 'value', 'decimals', 'prefix', 'suffix', 'fontSize', 'font', 'weight', 'anchor', 'color', 'fillOpacity'],
  code: ['id', 'kind', 'at', 'lines', 'fontSize', 'color', 'lineHeight'],
  codePanel: ['id', 'kind', 'at', 'lines', 'fontSize'],
  title: ['id', 'kind', 'at', 'text'],
  readout: ['id', 'kind', 'at', 'entries', 'fontSize', 'gap'],
  group: ['id', 'kind', 'at', 'children'],
  labeled: ['id', 'kind', 'at', 'shape', 'label', 'center'],
  card: ['id', 'kind', 'at', 'rows', 'padding', 'gap', 'align', 'cornerRadius', 'stroke', 'strokeWidth', 'fill', 'fillOpacity', 'fontSize', 'color'],
  flowchart: ['id', 'kind', 'at', 'source', 'width', 'height', 'fontSize', 'theme'],
  route: ['id', 'kind', 'at', 'from', 'to', 'avoid', 'stroke', 'strokeWidth', 'clearance', 'dock'],
};

function parseMob(input: unknown, path: string): Result<Mob> {
  if (!isRecord(input) || typeof input.kind !== 'string') return fail(path, 'expected an object');
  const kindName = input.kind;
  const keys = Object.hasOwn(MOB_KEYS, kindName) ? MOB_KEYS[kindName] : undefined;
  if (!keys) {
    const token = shownToken(kindName);
    return fail(path, token ? `unknown kind ${token}` : 'unknown kind');
  }
  const rec = fields(input, path, keys);
  if (!rec.ok) return rec;
  const o = rec.value;
  const acc = new Acc();
  let id: Id = asId('a');
  let at: Vec | null = null;
  acc.add(parseId(o.id, `${path}.id`), (v) => { id = v; });
  if (has(o, 'at')) acc.add(parseVec(o.at, `${path}.at`), (v) => { at = v; });
  const placed = <T extends Mob>(body: T): T => body;
  if (o.kind === 'rectangle') {
    let width: Units = asNum(4), height: Units = asNum(2), cornerRadius: Units = asNum(0), style: Style = EMPTY;
    acc.add(opt(o, 'width', path, parseSize, width), (v) => { width = v; });
    acc.add(opt(o, 'height', path, parseSize, height), (v) => { height = v; });
    acc.add(opt(o, 'cornerRadius', path, parseNonNeg, cornerRadius), (v) => { cornerRadius = v; });
    acc.add(opt(o, 'style', path, parseStyle, style), (v) => { style = v; });
    return acc.done(placed({ id, at, kind: 'rectangle', width, height, cornerRadius, style }));
  }
  if (o.kind === 'square') {
    let side: Units = asNum(2), cornerRadius: Units = asNum(0), style: Style = EMPTY;
    acc.add(opt(o, 'side', path, parseSize, side), (v) => { side = v; });
    acc.add(opt(o, 'cornerRadius', path, parseNonNeg, cornerRadius), (v) => { cornerRadius = v; });
    acc.add(opt(o, 'style', path, parseStyle, style), (v) => { style = v; });
    return acc.done({ id, at, kind: 'square', side, cornerRadius, style });
  }
  if (o.kind === 'circle') {
    let radius: Units = asNum(1), style: Style = EMPTY;
    acc.add(opt(o, 'radius', path, parseSize, radius), (v) => { radius = v; });
    acc.add(opt(o, 'style', path, parseStyle, style), (v) => { style = v; });
    return acc.done({ id, at, kind: 'circle', radius, style });
  }
  if (o.kind === 'dot') {
    let radius: Units = asNum(0.08), color: Color = defaultColor;
    acc.add(opt(o, 'radius', path, parseSize, radius), (v) => { radius = v; });
    acc.add(opt(o, 'color', path, parseColor, color), (v) => { color = v; });
    return acc.done({ id, at, kind: 'dot', radius, color });
  }
  if (o.kind === 'line' || o.kind === 'arcBetween' || o.kind === 'arrow' || o.kind === 'curvedArrow') {
    return parseEndpoints(o, path, acc, id, at);
  }
  if (o.kind === 'polygon') return parsePolygon(o, path, acc, id, at);
  if (o.kind === 'arc') return parseArc(o, path, acc, id, at);
  if (o.kind === 'text') return parseTextMob(o, path, acc, id, at);
  if (o.kind === 'decimal') return parseDecimal(o, path, acc, id, at);
  if (o.kind === 'code') return parseCode(o, path, acc, id, at, false);
  if (o.kind === 'codePanel') return parseCode(o, path, acc, id, at, true);
  if (o.kind === 'title') {
    let text: SafeText = asText('');
    acc.add(parseSafe(o.text, `${path}.text`, LIMITS.text), (v) => { text = v; });
    return acc.done({ id, at, kind: 'title', text });
  }
  if (o.kind === 'readout') return parseReadout(o, path, acc, id, at);
  if (o.kind === 'group') return parseGroup(o, path, acc, id, at);
  if (o.kind === 'labeled') return parseLabeled(o, path, acc, id, at);
  if (o.kind === 'card') return parseCard(o, path, acc, id, at);
  if (o.kind === 'flowchart') return parseChart(o, path, acc, id, at);
  return parseRoute(o, path, acc, id, at);
}

function parseEndpoints(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let start: Vec = [asNum(-1), asNum(0)], end: Vec = [asNum(1), asNum(0)], style: Style = EMPTY;
  acc.add(parseVec(o.start, `${path}.start`), (v) => { start = v; });
  acc.add(parseVec(o.end, `${path}.end`), (v) => { end = v; });
  if (o.kind === 'line') {
    acc.add(opt(o, 'style', path, parseStyle, style), (v) => { style = v; });
    return acc.done({ id, at, kind: 'line', start, end, style });
  }
  if (o.kind === 'arcBetween') {
    let angle: Angle = asNum(0.8);
    acc.add(opt(o, 'angle', path, parseTurn, angle), (v) => { angle = v; });
    acc.add(opt(o, 'style', path, parseStyle, style), (v) => { style = v; });
    return acc.done({ id, at, kind: 'arcBetween', start, end, angle, style });
  }
  let tipLength: Units = asNum(o.kind === 'arrow' ? 0.3 : 0.28);
  let tipWidth: Units = asNum(o.kind === 'arrow' ? 0.22 : 0.2);
  let stroke: Paint = defaultColor, strokeWidth: Units = asNum(0.04);
  acc.add(opt(o, 'tipLength', path, parseSize, tipLength), (v) => { tipLength = v; });
  acc.add(opt(o, 'tipWidth', path, parseSize, tipWidth), (v) => { tipWidth = v; });
  acc.add(opt(o, 'stroke', path, parsePaint, stroke), (v) => { stroke = v; });
  acc.add(opt(o, 'strokeWidth', path, parseNonNeg, strokeWidth), (v) => { strokeWidth = v; });
  if (o.kind === 'arrow') {
    let buff: Units = asNum(0);
    acc.add(opt(o, 'buff', path, parseNonNeg, buff), (v) => { buff = v; });
    return acc.done({ id, at, kind: 'arrow', start, end, tipLength, tipWidth, buff, stroke, strokeWidth });
  }
  let angle: Angle = asNum(0.8);
  acc.add(opt(o, 'angle', path, parseTurn, angle), (v) => { angle = v; });
  return acc.done({ id, at, kind: 'curvedArrow', start, end, angle, tipLength, tipWidth, stroke, strokeWidth });
}

function parsePolygon(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let style: Style = EMPTY;
  const points: Vec[] = [];
  if (!Array.isArray(o.points) || o.points.length < 3 || o.points.length > LIMITS.points) {
    acc.add(fail(`${path}.points`, `expected 3 to ${LIMITS.points} points`), () => {});
  } else o.points.forEach((p, i) => acc.add(parseVec(p, `${path}.points[${i}]`), (v) => points.push(v)));
  acc.add(opt(o, 'style', path, parseStyle, style), (v) => { style = v; });
  return acc.done({ id, at, kind: 'polygon', points, style });
}

function parseArc(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let radius: Units = asNum(1), startAngle: Angle = asNum(0), angle: Angle = asNum(1.57), style: Style = EMPTY;
  acc.add(opt(o, 'radius', path, parseSize, radius), (v) => { radius = v; });
  acc.add(opt(o, 'startAngle', path, parseAngle, startAngle), (v) => { startAngle = v; });
  acc.add(opt(o, 'angle', path, parseAngle, angle), (v) => { angle = v; });
  acc.add(opt(o, 'style', path, parseStyle, style), (v) => { style = v; });
  return acc.done({ id, at, kind: 'arc', radius, startAngle, angle, style });
}

function parseTextMob(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  const text = blankText();
  acc.add(parseSafe(o.text, `${path}.text`, LIMITS.text), (v) => { text.text = v; });
  acc.add(parseTextOpts(o, path), (v) => Object.assign(text, v));
  return acc.done({ id, at, kind: 'text', ...text });
}

function parseDecimal(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  const text = blankText();
  let value = 0, decimals = 0, prefix: SafeText = asText(''), suffix: SafeText = asText('');
  acc.add(finite(o.value, `${path}.value`), (v) => {
    if (Math.abs(v) > 1e9) acc.add(fail(`${path}.value`, 'number is out of range'), () => {});
    else value = v;
  });
  acc.add(opt(o, 'decimals', path, (v, p) => {
    const n = finite(v, p);
    if (!n.ok) return n;
    if (!Number.isInteger(n.value) || n.value < 0 || n.value > 6) return fail(p, 'decimals must be an integer from 0 to 6');
    return ok(n.value);
  }, 0), (v) => { decimals = v; });
  acc.add(opt(o, 'prefix', path, (v, p) => parseSafe(v, p, LIMITS.prefix), prefix), (v) => { prefix = v; });
  acc.add(opt(o, 'suffix', path, (v, p) => parseSafe(v, p, LIMITS.prefix), suffix), (v) => { suffix = v; });
  acc.add(parseTextOpts(o, path), (v) => Object.assign(text, v));
  return acc.done({ id, at, kind: 'decimal', value, decimals, prefix, suffix, fontSize: text.fontSize, font: text.font, weight: text.weight, anchor: text.anchor, color: text.color, fillOpacity: text.fillOpacity });
}

function parseLines(input: unknown, path: string): Result<readonly SafeText[]> {
  if (!Array.isArray(input) || input.length < 1 || input.length > LIMITS.lines) return fail(path, `expected 1 to ${LIMITS.lines} lines`);
  const acc = new Acc();
  const lines: SafeText[] = [];
  input.forEach((line, i) => acc.add(parseSafe(line, `${path}[${i}]`, LIMITS.line), (v) => lines.push(v)));
  return acc.done(lines);
}

function parseCode(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null, panel: boolean): Result<Mob> {
  let lines: readonly SafeText[] = [], fontSize: Units = asNum(0.26), color: Color = canonical('#dddddd'), lineHeight: Factor = asNum(1.5);
  acc.add(parseLines(o.lines, `${path}.lines`), (v) => { lines = v; });
  acc.add(opt(o, 'fontSize', path, parseSize, fontSize), (v) => { fontSize = v; });
  if (!panel) {
    acc.add(opt(o, 'color', path, parseColor, color), (v) => { color = v; });
    acc.add(opt(o, 'lineHeight', path, (v, p) => parseFactor(v, p, 1, 3), lineHeight), (v) => { lineHeight = v; });
    return acc.done({ id, at, kind: 'code', lines, fontSize, color, lineHeight });
  }
  return acc.done({ id, at, kind: 'codePanel', lines, fontSize });
}

function parseReadout(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let fontSize: Units = asNum(0.3), gap: Units = asNum(0.5);
  const entries: (readonly [SafeText, Scalar])[] = [];
  if (!Array.isArray(o.entries) || o.entries.length < 1 || o.entries.length > LIMITS.entries) {
    acc.add(fail(`${path}.entries`, `expected 1 to ${LIMITS.entries} entries`), () => {});
  } else o.entries.forEach((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) { acc.add(fail(`${path}.entries[${i}]`, 'expected [key, value]'), () => {}); return; }
    let key: SafeText = asText('k'), value: Scalar = 0;
    acc.add(parseSafe(entry[0], `${path}.entries[${i}][0]`, 32), (v) => {
      if (v.includes('__proto__')) acc.add(fail(`${path}.entries[${i}][0]`, 'key is not allowed'), () => {});
      else key = v;
    });
    acc.add(parseScalar(entry[1], `${path}.entries[${i}][1]`), (v) => { value = v; });
    entries.push([key, value]);
  });
  acc.add(opt(o, 'fontSize', path, parseSize, fontSize), (v) => { fontSize = v; });
  acc.add(opt(o, 'gap', path, parseSize, gap), (v) => { gap = v; });
  return acc.done({ id, at, kind: 'readout', entries, fontSize, gap });
}

function parseIdList(input: unknown, path: string, min: number, max: number): Result<readonly Id[]> {
  if (!Array.isArray(input) || input.length < min || input.length > max) return fail(path, `expected ${min} to ${max} ids`);
  const acc = new Acc();
  const ids: Id[] = [];
  input.forEach((item, i) => acc.add(parseId(item, `${path}[${i}]`), (v) => ids.push(v)));
  return acc.done(ids);
}

function parseGroup(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let children: readonly Id[] = [];
  acc.add(parseIdList(o.children, `${path}.children`, 1, LIMITS.children), (v) => { children = v; });
  return acc.done({ id, at, kind: 'group', children });
}

function parseLabeled(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let shape: Id = asId('a'), label: Id = asId('b'), center = true;
  acc.add(parseId(o.shape, `${path}.shape`), (v) => { shape = v; });
  acc.add(parseId(o.label, `${path}.label`), (v) => { label = v; });
  if (has(o, 'center')) {
    if (typeof o.center !== 'boolean') acc.add(fail(`${path}.center`, 'expected a boolean'), () => {});
    else center = o.center;
  }
  return acc.done({ id, at, kind: 'labeled', shape, label, center });
}

function parseCard(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let rows: readonly SafeText[] = [], padding: Units = asNum(0.28), gap: Units = asNum(0.16);
  let align: 'start' | 'center' = 'start', cornerRadius: Units = asNum(0.12);
  let stroke: Paint = defaultColor, strokeWidth: Units = asNum(0.04), fill: Paint = defaultColor, fillOpacity: Portion = asNum(0.06);
  let fontSize: Units = asNum(0.28), color: Color = defaultColor;
  acc.add(parseLines(o.rows, `${path}.rows`), (v) => { rows = v; });
  acc.add(opt(o, 'padding', path, parseNonNeg, padding), (v) => { padding = v; });
  acc.add(opt(o, 'gap', path, parseNonNeg, gap), (v) => { gap = v; });
  if (has(o, 'align')) {
    if (o.align !== 'start' && o.align !== 'center') acc.add(fail(`${path}.align`, "align must be 'start' or 'center'"), () => {});
    else align = o.align;
  }
  acc.add(opt(o, 'cornerRadius', path, parseNonNeg, cornerRadius), (v) => { cornerRadius = v; });
  acc.add(opt(o, 'stroke', path, parsePaint, stroke), (v) => { stroke = v; });
  acc.add(opt(o, 'strokeWidth', path, parseNonNeg, strokeWidth), (v) => { strokeWidth = v; });
  acc.add(opt(o, 'fill', path, parsePaint, fill), (v) => { fill = v; });
  acc.add(opt(o, 'fillOpacity', path, parsePortion, fillOpacity), (v) => { fillOpacity = v; });
  acc.add(opt(o, 'fontSize', path, parseSize, fontSize), (v) => { fontSize = v; });
  acc.add(opt(o, 'color', path, parseColor, color), (v) => { color = v; });
  return acc.done({ id, at, kind: 'card', rows, padding, gap, align, cornerRadius, stroke, strokeWidth, fill, fillOpacity, fontSize, color });
}

const DEFAULT_THEME: FlowTheme = {
  node: { stroke: canonical('#58c4dd'), fill: canonical('#58c4dd'), fillOpacity: asNum(0.12), color: defaultColor, strokeWidth: asNum(0.03) },
  cluster: { stroke: canonical('#4a4a4a'), fill: defaultColor, fillOpacity: asNum(0.04), color: canonical('#9a9a9a'), strokeWidth: asNum(0.022) },
  edge: { stroke: canonical('#8a8a8a'), color: canonical('#bbbbbb'), strokeWidth: asNum(0.024) },
  labelBg: defaultBg,
};

function withPaint(base: FlowTheme['node'], v: FlowPaint): FlowTheme['node'] {
  return {
    stroke: v.stroke, fill: v.fill, color: v.color,
    fillOpacity: v.fillOpacity ?? base.fillOpacity,
    strokeWidth: v.strokeWidth ?? base.strokeWidth,
  };
}

function parseTheme(input: unknown, path: string): Result<FlowTheme> {
  const rec = fields(input, path, ['node', 'cluster', 'edge', 'labelBg']);
  if (!rec.ok) return rec;
  const o = rec.value;
  const acc = new Acc();
  let node = DEFAULT_THEME.node;
  let cluster = DEFAULT_THEME.cluster;
  let edge = DEFAULT_THEME.edge;
  let labelBg = DEFAULT_THEME.labelBg;
  if (has(o, 'node')) acc.add(parseFlowPaint(o.node, `${path}.node`, true), (v) => { node = withPaint(node, v); });
  if (has(o, 'cluster')) acc.add(parseFlowPaint(o.cluster, `${path}.cluster`, true), (v) => { cluster = withPaint(cluster, v); });
  if (has(o, 'edge')) acc.add(parseFlowPaint(o.edge, `${path}.edge`, false), (v) => {
    edge = { stroke: v.stroke, color: v.color, strokeWidth: v.strokeWidth ?? edge.strokeWidth };
  });
  if (has(o, 'labelBg')) acc.add(parseColor(o.labelBg, `${path}.labelBg`), (v) => { labelBg = v; });
  return acc.done({ node, cluster, edge, labelBg });
}

type FlowPaint = { stroke: Color; fill: Color; color: Color; fillOpacity?: Portion; strokeWidth?: Units };

function parseFlowPaint(input: unknown, path: string, withFill: boolean): Result<FlowPaint> {
  const rec = fields(input, path, withFill ? ['stroke', 'fill', 'fillOpacity', 'color', 'strokeWidth'] : ['stroke', 'color', 'strokeWidth']);
  if (!rec.ok) return rec;
  const o = rec.value;
  const acc = new Acc();
  let stroke = defaultColor, fill = defaultColor, color = defaultColor, fillOpacity: Portion | undefined, strokeWidth: Units | undefined;
  acc.add(opt(o, 'stroke', path, parseColor, stroke), (v) => { stroke = v; });
  if (withFill) {
    acc.add(opt(o, 'fill', path, parseColor, fill), (v) => { fill = v; });
    if (has(o, 'fillOpacity')) acc.add(parsePortion(o.fillOpacity, `${path}.fillOpacity`), (v) => { fillOpacity = v; });
  }
  acc.add(opt(o, 'color', path, parseColor, color), (v) => { color = v; });
  if (has(o, 'strokeWidth')) acc.add(parseNonNeg(o.strokeWidth, `${path}.strokeWidth`), (v) => { strokeWidth = v; });
  return acc.done({ stroke, fill, color, fillOpacity, strokeWidth });
}

function parseFlowSource(input: unknown, path: string): Result<FlowSource> {
  if (typeof input !== 'string') return fail(path, 'expected a string');
  if (input.length < 1 || input.length > LIMITS.flow) return fail(path, `source must be 1 to ${LIMITS.flow} characters`);
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c === 127) return fail(path, 'source contains a control character');
  }
  // Paint comes from `theme`. Directives that carry their own paint never reach the renderer.
  if (/\bstyle\b|\bclassDef\b|\blinkStyle\b|:::/.test(input)) return fail(path, 'style, classDef, linkStyle, and ::: are not accepted; set theme instead');
  return ok(input as FlowSource);
}

function parseChart(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let source: FlowSource = 'flowchart LR\nA-->B' as FlowSource;
  let width: Units = asNum(12), height: Units = asNum(6), fontSize: Units = asNum(0.24), theme = DEFAULT_THEME;
  acc.add(parseFlowSource(o.source, `${path}.source`), (v) => { source = v; });
  acc.add(opt(o, 'width', path, parseSize, width), (v) => { width = v; });
  acc.add(opt(o, 'height', path, parseSize, height), (v) => { height = v; });
  acc.add(opt(o, 'fontSize', path, parseSize, fontSize), (v) => { fontSize = v; });
  acc.add(has(o, 'theme') ? parseTheme(o.theme, `${path}.theme`) : ok(DEFAULT_THEME), (v) => { theme = v; });
  return acc.done({ id, at, kind: 'flowchart', source, width, height, fontSize, theme });
}

function parseRoute(o: Record<string, unknown>, path: string, acc: Acc, id: Id, at: Vec | null): Result<Mob> {
  let from: Id = asId('a'), to: Id = asId('b'), avoid: readonly Id[] = [];
  let stroke: Paint = defaultColor, strokeWidth: Units = asNum(0.04), clearance: Units = asNum(0.15);
  let dock: 'auto' | 'side' | 'facing' = 'auto';
  acc.add(parseId(o.from, `${path}.from`), (v) => { from = v; });
  acc.add(parseId(o.to, `${path}.to`), (v) => { to = v; });
  acc.add(has(o, 'avoid') ? parseIdList(o.avoid, `${path}.avoid`, 0, LIMITS.children) : ok(avoid), (v) => { avoid = v; });
  acc.add(opt(o, 'stroke', path, parsePaint, stroke), (v) => { stroke = v; });
  acc.add(opt(o, 'strokeWidth', path, parseNonNeg, strokeWidth), (v) => { strokeWidth = v; });
  acc.add(opt(o, 'clearance', path, parseNonNeg, clearance), (v) => { clearance = v; });
  if (has(o, 'dock')) {
    if (o.dock !== 'auto' && o.dock !== 'side' && o.dock !== 'facing') acc.add(fail(`${path}.dock`, "dock must be 'auto', 'side', or 'facing'"), () => {});
    else dock = o.dock;
  }
  return acc.done({ id, at, kind: 'route', from, to, avoid, stroke, strokeWidth, clearance, dock });
}

function parsePlay(input: unknown, path: string): Result<Play> {
  if (!isRecord(input)) return fail(path, 'expected a play');
  if (has(input, 'wait') || input.kind === 'wait') {
    const rec = fields(input, path, ['kind', 'wait', 'seconds']);
    if (!rec.ok) return rec;
    const raw = has(input, 'seconds') ? input.seconds : input.wait;
    const seconds = parseSeconds(raw, `${path}.seconds`, 0);
    return seconds.ok ? ok({ kind: 'wait', seconds: seconds.value }) : seconds;
  }
  if (input.kind === 'set') {
    const rec = fields(input, path, ['kind', 'values']);
    if (!rec.ok) return rec;
    return mapPairs(input.values, `${path}.values`, (pairs) => ({ kind: 'set' as const, values: pairs }));
  }
  if (input.kind === 'reveal') {
    const rec = fields(input, path, ['kind', 'target', 'runTime', 'lagRatio']);
    if (!rec.ok) return rec;
    const acc = new Acc();
    let target: Id = asId('a'), runTime: Seconds = asNum(1), lagRatio: Portion = asNum(0.15);
    acc.add(parseId(input.target, `${path}.target`), (v) => { target = v; });
    acc.add(opt(input, 'runTime', path, (v, p) => parseSeconds(v, p), runTime), (v) => { runTime = v; });
    acc.add(opt(input, 'lagRatio', path, parsePortion, lagRatio), (v) => { lagRatio = v; });
    return acc.done({ kind: 'reveal', target, runTime, lagRatio });
  }
  const rec = fields(input, path, ['kind', 'animations', 'runTime', 'rate', 'lagRatio']);
  if (!rec.ok) return rec;
  if (!Array.isArray(input.animations) || input.animations.length < 1 || input.animations.length > LIMITS.animsPerPlay) {
    return fail(`${path}.animations`, `expected 1 to ${LIMITS.animsPerPlay} animations`);
  }
  const acc = new Acc();
  const animations: Anim[] = [];
  input.animations.forEach((item, i) => acc.add(parseAnim(item, `${path}.animations[${i}]`), (v) => animations.push(v)));
  const opts: { runTime?: Seconds; rate?: RateName; lagRatio?: Portion } = {};
  if (has(input, 'runTime')) acc.add(parseSeconds(input.runTime, `${path}.runTime`), (v) => { opts.runTime = v; });
  if (has(input, 'rate')) acc.add(parseRate(input.rate, `${path}.rate`), (v) => { opts.rate = v; });
  if (has(input, 'lagRatio')) acc.add(parsePortion(input.lagRatio, `${path}.lagRatio`), (v) => { opts.lagRatio = v; });
  return acc.done({ kind: 'play', animations, ...opts });
}

function mapPairs<T>(input: unknown, path: string, build: (pairs: (readonly [Id, Scalar])[]) => T): Result<T> {
  if (!isRecord(input)) return fail(path, 'expected an object');
  const keys = Object.keys(input);
  if (keys.length > LIMITS.stateKeys) return fail(path, `at most ${LIMITS.stateKeys} keys`);
  const acc = new Acc();
  const pairs: (readonly [Id, Scalar])[] = [];
  for (const key of keys) {
    if (!ID.test(key)) { acc.add(fail(path, 'expected an identifier key'), () => {}); continue; }
    const id = asId(key);
    acc.add(parseScalar(input[key], `${path}.${key}`), (value) => pairs.push([id, value]));
  }
  return acc.done(build(pairs));
}

function parseStep(input: unknown, path: string): Result<Step> {
  const rec = fields(input, path, ['name', 'meta', 'plays']);
  if (!rec.ok) return rec;
  const o = rec.value;
  const acc = new Acc();
  let name: Id = asId('s');
  const meta: Record<string, Scalar> = Object.create(null);
  const plays: Play[] = [];
  acc.add(parseId(o.name, `${path}.name`), (v) => { name = v; });
  if (has(o, 'meta')) {
    if (!isRecord(o.meta)) acc.add(fail(`${path}.meta`, 'expected an object'), () => {});
    else {
      const keys = Object.keys(o.meta);
      if (keys.length > LIMITS.metaKeys) acc.add(fail(`${path}.meta`, `at most ${LIMITS.metaKeys} keys`), () => {});
      for (const key of keys) {
        if (!ID.test(key)) acc.add(fail(`${path}.meta`, 'expected an identifier key'), () => {});
        else acc.add(parseScalar(o.meta[key], `${path}.meta.${key}`), (v) => { meta[key] = v; });
      }
    }
  }
  if (!Array.isArray(o.plays) || o.plays.length > LIMITS.playsPerStep) acc.add(fail(`${path}.plays`, `expected at most ${LIMITS.playsPerStep} plays`), () => {});
  else (o.plays as unknown[]).forEach((play, i) => acc.add(parsePlay(play, `${path}.plays[${i}]`), (v) => plays.push(v)));
  return acc.done({ name, meta, plays });
}

/** Frames one play contributes. A reveal is charged for every stage it may play. */
function playFrames(play: Play, fps: number): number {
  if (play.kind === 'set') return 0;
  if (play.kind === 'wait') return Math.round(play.seconds * fps);
  const seconds = play.kind === 'reveal' || play.kind === 'play' ? (play.kind === 'reveal' ? play.runTime : (play.runTime ?? 1)) : 0;
  const once = Math.max(1, Math.round(seconds * fps));
  return play.kind === 'reveal' ? once * LIMITS.revealStages : once;
}

/**
 * Upper bound on frames a scene will emit, including the opening frame and a
 * caption hold (Scene holds a step until its caption could be read).
 */
export function estimateFrames(doc: SceneDoc): number {
  let frames = 1 + Math.round(doc.outro * doc.fps);
  for (const step of doc.steps) {
    const caption = step.meta.caption;
    if (typeof caption === 'string' && caption.trim() !== '') {
      const words = caption.trim().split(/\s+/).length;
      frames += Math.ceil(words / 160 * 60 * doc.fps);
    }
    for (const play of step.plays) frames += playFrames(play, doc.fps);
  }
  return frames;
}

function checkRefs(doc: SceneDoc): Result<SceneDoc> {
  const ids = new Set(doc.objects.map((o) => o.id));
  if (ids.size !== doc.objects.length) return fail('objects', 'object ids must be unique');
  const errors: { path: string; message: string }[] = [];
  const need = (id: string, path: string): void => {
    if (!ids.has(id as Id)) errors.push({ path, message: `unknown object ${id}` });
  };
  const childUse = new Map<string, string>();
  const claim = (id: string, owner: string, path: string): void => {
    const prev = childUse.get(id);
    if (prev) errors.push({ path, message: `${id} is already a child of ${prev}` });
    else childUse.set(id, owner);
    need(id, path);
  };
  for (const o of doc.objects) {
    if (o.kind === 'group') o.children.forEach((c, i) => claim(c, o.id, `objects.${o.id}.children[${i}]`));
    if (o.kind === 'labeled') { claim(o.shape, o.id, `objects.${o.id}.shape`); claim(o.label, o.id, `objects.${o.id}.label`); }
    if (o.kind === 'route') {
      need(o.from, `objects.${o.id}.from`); need(o.to, `objects.${o.id}.to`);
      o.avoid.forEach((c, i) => need(c, `objects.${o.id}.avoid[${i}]`));
    }
  }
  const byId = new Map(doc.objects.map((o) => [o.id, o]));
  for (const step of doc.steps) for (const play of step.plays) {
    if (play.kind === 'reveal') {
      const t = byId.get(play.target as Id);
      if (!t) errors.push({ path: `steps.${step.name}`, message: `unknown object ${play.target}` });
      else if (t.kind !== 'flowchart') errors.push({ path: `steps.${step.name}`, message: 'reveal target must be a flowchart' });
    }
    if (play.kind !== 'play') continue;
    const walk = (anim: Anim, path: string): void => {
      if (anim.kind === 'group' || anim.kind === 'lagged') { anim.animations.forEach((a, i) => walk(a, `${path}[${i}]`)); return; }
      need(anim.target, path);
      if (anim.kind === 'moveAlong') need(anim.path, path);
      if (anim.kind === 'focus') {
        const t = byId.get(anim.target);
        if (t && t.kind === 'codePanel' && anim.line >= t.lines.length) errors.push({ path, message: 'focus line is past the end of the code' });
        if (t && t.kind !== 'codePanel') errors.push({ path, message: 'focus target must be a codePanel' });
      }
      if (anim.kind === 'unfocus') {
        const t = byId.get(anim.target);
        if (t && t.kind !== 'codePanel') errors.push({ path, message: 'unfocus target must be a codePanel' });
      }
    };
    play.animations.forEach((a, i) => walk(a, `steps.${step.name}.animations[${i}]`));
  }
  // A child cycle is a group that eventually contains itself.
  const stack = new Set<string>();
  const see = (id: string): boolean => {
    if (stack.has(id)) return true;
    stack.add(id);
    const o = byId.get(id as Id);
    const kids = o?.kind === 'group' ? o.children : o?.kind === 'labeled' ? [o.shape, o.label] : [];
    const cycle = kids.some((k) => see(k));
    stack.delete(id);
    return cycle;
  };
  for (const o of doc.objects) if ((o.kind === 'group' || o.kind === 'labeled') && see(o.id)) {
    errors.push({ path: `objects.${o.id}`, message: 'objects contain a cycle' });
    break;
  }
  if (estimateFrames(doc) > LIMITS.maxFrames) errors.push({ path: 'scene', message: `scene exceeds ${LIMITS.maxFrames} frames; lower fps or shorten plays` });
  return errors.length ? { ok: false, errors } : ok(doc);
}

export function parseScene(input: unknown): Result<SceneDoc> {
  const rec = fields(input, 'scene', ['camera', 'fps', 'outro', 'state', 'objects', 'steps']);
  if (!rec.ok) return rec;
  const o = rec.value;
  const acc = new Acc();
  let w: Units = asNum(16), h: Units = asNum(9), fps: Fps = asNum<'fps'>(10), outro: Seconds = asNum(0);
  let state: (readonly [Id, Scalar])[] = [];
  const objects: Mob[] = [];
  const steps: Step[] = [];
  if (has(o, 'camera')) {
    const cam = fields(o.camera, 'scene.camera', ['w', 'h']);
    if (!cam.ok) acc.add(cam, () => {});
    else {
      acc.add(opt(cam.value, 'w', 'scene.camera', (v, p) => ranged(v, p, LIMITS.cameraMin, LIMITS.cameraMax, 'u', 'camera width'), w), (v) => { w = v; });
      acc.add(opt(cam.value, 'h', 'scene.camera', (v, p) => ranged(v, p, LIMITS.cameraMin, LIMITS.cameraMax, 'u', 'camera height'), h), (v) => { h = v; });
    }
  }
  acc.add(has(o, 'fps') ? parseFps(o.fps, 'scene.fps') : ok(fps), (v) => { fps = v; });
  acc.add(has(o, 'outro') ? parseSeconds(o.outro, 'scene.outro', 0) : ok(outro), (v) => { outro = v; });
  if (has(o, 'state')) acc.add(mapPairs(o.state, 'scene.state', (pairs) => pairs), (v) => { state = v; });
  if (!Array.isArray(o.objects) || o.objects.length < 1 || o.objects.length > LIMITS.objects) acc.add(fail('scene.objects', `expected 1 to ${LIMITS.objects} objects`), () => {});
  else o.objects.forEach((item, i) => acc.add(parseMob(item, `scene.objects[${i}]`), (v) => objects.push(v)));
  if (has(o, 'steps')) {
    if (!Array.isArray(o.steps) || o.steps.length > LIMITS.steps) acc.add(fail('scene.steps', `expected at most ${LIMITS.steps} steps`), () => {});
    else o.steps.forEach((item, i) => acc.add(parseStep(item, `scene.steps[${i}]`), (v) => steps.push(v)));
  }
  const built = acc.done({ camera: { w, h }, fps, outro, state, objects, steps });
  if (!built.ok) return built;
  const names = new Set<string>();
  for (const step of built.value.steps) {
    if (names.has(step.name)) return fail(`scene.steps`, `duplicate step ${step.name}`);
    names.add(step.name);
  }
  return checkRefs(built.value);
}

export function parseEnvelope(input: unknown): Result<Envelope> {
  const rec = fields(input, 'body', ['scene', 'output']);
  if (!rec.ok) return rec;
  const scene = parseScene(rec.value.scene);
  const output = has(rec.value, 'output')
    ? parseOutput(rec.value.output, 'output')
    : ok<Output>({ format: 'svg', select: { kind: 'end' }, width: DEFAULT_WIDTH, background: DEFAULT_BACKGROUND });
  if (!scene.ok || !output.ok) {
    return { ok: false, errors: [...(scene.ok ? [] : scene.errors), ...(output.ok ? [] : output.errors)] };
  }
  if (output.value.format === 'frames' && estimateFrames(scene.value) > LIMITS.framesFormat) {
    return fail('output.format', `frames output is limited to ${LIMITS.framesFormat} frames`);
  }
  return ok({ scene: scene.value, output: output.value });
}

/** Query string for the shortcut routes. Absent fields stay at the defaults. */
export function parseQueryOutput(format: Output['format'], params: URLSearchParams): Result<Output> {
  const select = querySelect(params);
  if (!select.ok) return select;
  if (format === 'trace' || format === 'index') {
    if (params.has('w') || params.has('background') || params.has('t') || params.has('step')) {
      return fail('query', 'this route takes a scene and no frame parameters');
    }
    return ok(format === 'trace' ? { format } : { format: 'index' });
  }
  if (format === 'text' || format === 'elements') {
    if (params.has('w') || params.has('background')) return fail('query', 'width and background belong on svg output');
    return ok({ format, select: select.value });
  }
  const width = params.has('w') ? numberParam(params.get('w'), 'w') : undefined;
  const background = params.has('background') ? params.get('background') : undefined;
  const pair = parseSvgPair(width, background ?? undefined, 'w', 'background');
  if (!pair.ok) return pair;
  return ok({ format: 'svg', select: select.value, width: pair.value.width, background: pair.value.background });
}

function numberParam(raw: string | null, path: string): unknown {
  if (raw == null || raw.trim() === '' || !/^-?\d+$/.test(raw)) return raw;
  return Number(raw);
}

function querySelect(params: URLSearchParams): Result<Select> {
  const step = params.get('step');
  const t = params.get('t');
  if (step != null && step.length > 64) return fail('step', 'step name is too long');
  if (step != null && /[\u0000-\u001f\u007f]/.test(step)) return fail('step', 'step name contains a control character');
  if (t == null) return ok(step ? { kind: 'step', name: step } : { kind: 'end' });
  if (!/^-?\d+(\.\d+)?$/.test(t)) return fail('t', 't must be a number of seconds');
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > LIMITS.runMax * LIMITS.steps) return fail('t', 't is out of range');
  return ok({ kind: 'time', t: asNum<'seconds'>(n) });
}
