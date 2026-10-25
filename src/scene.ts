// Scene: an ordered list of top-level mobjects, a clock, and a frame loop.
//
// play() is async so one scene definition drives both a real-time browser
// sink (which awaits requestAnimationFrame) and an offline string sink
// (which resolves immediately). The loop itself uses a fixed dt, so output is
// deterministic regardless of sink.

import { prepareAnimation, AnimationGroup } from './animation.ts';
import type { Animation, Playable, PlayOpts } from './animation.ts';
import type { Mobject } from './mobject.ts';
import { perf } from './perf.ts';
import { loadFonts } from './fonts.ts';

/** Thrown by a sink to end the run early (seeking). */
export class StopScene extends Error {}

/** Free-form data attached to a step; travels with the trace. A string `caption` holds the step until read. */
export type StepMeta = Record<string, unknown>;

/** A named step: from `step()` to the next step or the end of the scene. */
export interface Step {
  name: string;
  path: string;
  t0: number;
  frame0: number;
  t1: number | null;
  frame1: number | null;
  meta: StepMeta;
}

/**
 * What a scene renders into: called once per frame (dt = 0 for the first),
 * and at step boundaries if it cares. Async, so a sink can pace or stop the run.
 */
export interface Sink {
  frame(scene: Scene, dt: number): Promise<void>;
  stepBegin?(scene: Scene, step: Step): Promise<void>;
  stepEnd?(scene: Scene, step: Step): Promise<void>;
}

export interface SceneOptions {
  fps?: number;
  /** Frames that end before this time are counted, not rendered (seeking). */
  skipUntil?: number;
}

/** The explanation's own state: JSON, since that is what traces serve and tests hash. */
export type SceneState = Record<string, unknown>;

/** A scene class, as traceScene(), renderAt() and the registries take it. */
export type SceneClass = new (sink: Sink, opts?: SceneOptions) => Scene;

/**
 * Two animations in one play() must not drive the same mobject (or one
 * inside the other): each writes the mobject's points and style every frame,
 * so the last one listed would silently win. Nested groups (LaggedStart,
 * AnimationGroup) are checked through their members.
 */
function assertDisjoint(anims: readonly Animation[]): void {
  const seen = new Map<Mobject, Animation>();
  const leaves = (a: Animation): Animation[] => (a instanceof AnimationGroup ? a.animations.flatMap(leaves) : [a]);
  for (const a of anims.flatMap(leaves)) {
    for (const m of a.mobject.family()) {
      const other = seen.get(m);
      if (other && other !== a) {
        const name = (x: Animation) => `${x.constructor.name}(${x.mobject.constructor.name}#${x.mobject.id})`;
        throw new Error(`play(): ${name(other)} and ${name(a)} both animate ${m.constructor.name}#${m.id}; one play() can drive a mobject only once (sequence them, or combine into one Transform)`);
      }
      seen.set(m, a);
    }
  }
}

export class Scene {
  sink: Sink;
  fps: number;
  skipUntil: number;
  mobjects: Mobject[];
  time: number;
  frameCount: number;
  steps: Step[];
  current: Step | null;
  state: SceneState;

  /**
   * skipUntil: frames that end before this time are not rendered or
   * interpolated, only counted (manim's skip_animations). Interpolation is a
   * pure function of alpha over endpoints fixed at begin(), so the state after
   * a skipped stretch is exactly the state a full run reaches. Plays with
   * active updaters are never skipped: updaters integrate over frames.
   */
  constructor(sink: Sink, { fps = 30, skipUntil = 0 }: SceneOptions = {}) {
    this.sink = sink;
    this.fps = fps;
    this.skipUntil = skipUntil;
    this.mobjects = [];
    this.time = 0;
    this.frameCount = 0;
    // Named steps: the addressable unit for deep links, traces and tests
    this.steps = [];
    this.current = null;
    // The explanation's own state; describe() snapshots it for traces
    this.state = {};
  }

  /** Subclasses define the animation here. */
  async construct(): Promise<void> {}

  async run(): Promise<this> {
    try {
      await loadFonts();
      await this.sink.frame(this, 0);
      await this.construct();
      await this.endCurrentStep();
    } catch (e) {
      if (!(e instanceof StopScene)) throw e;
    }
    return this;
  }

  /**
   * Begin a named step; it lasts until the next step begins or the scene ends.
   *
   *   await this.step('push-a', { op: 'push' });
   *   await this.play(...);
   *
   * Names are stable tokens ("push-wrap"): they are what ?step= deep links,
   * traces and tests address. `meta` is free-form and travels with the trace.
   */
  async step(name: string, meta: StepMeta = {}): Promise<Step> {
    if (typeof meta === 'function') throw new TypeError('step(name, fn) is gone: call `await this.step(name)` where the step begins');
    await this.endCurrentStep();
    const s: Step = { name, path: name, t0: this.time, frame0: this.frameCount, t1: null, frame1: null, meta };
    this.steps.push(s);
    this.current = s;
    await this.sink.stepBegin?.(this, s);
    return s;
  }

  /** Words per minute a caption is read at; a step lasts at least that long. */
  static captionWpm = 160;

  async endCurrentStep(): Promise<void> {
    const s = this.current;
    if (!s) return;
    // A captioned step holds until its caption could have been read or spoken,
    // so narration (or a reader) never runs past the picture it describes.
    const caption = s.meta?.caption;
    if (typeof caption === 'string') {
      const need = caption.trim().split(/\s+/).length / Scene.captionWpm * 60;
      const left = need - (this.time - s.t0);
      if (left > 1e-9) await this.wait(left);
    }
    this.current = null;
    s.t1 = this.time; s.frame1 = this.frameCount;
    await this.sink.stepEnd?.(this, s);
  }

  hasUpdaters(): boolean {
    for (const top of this.mobjects) for (const m of top.family()) if (m.updaters.length) return true;
    return false;
  }

  /** The step running now, or null. */
  get currentStep(): Step | null { return this.current; }

  /**
   * What the explanation is about, for traces: a snapshot of `this.state`.
   * Scenes keep their explicit state there (head, tail, tokens...) and
   * mutate it as the animation makes the same change on screen.
   * State is JSON: that is what traces serve and tests hash.
   */
  describe(): SceneState { return JSON.parse(JSON.stringify(this.state)) as SceneState; }

  // ---- mobject list ------------------------------------------------------

  familyMembers(): Mobject[] { return this.mobjects.flatMap((m) => m.family()); }

  add(...mobs: Mobject[]): this {
    // Re-adding moves to the front. A mobject drawn through a parent must not
    // also be a root, or the renderer paints it twice (the smeared text).
    // Adding a child of something already on screen is a no-op.
    const covered = new Set<Mobject>();
    for (const m of mobs) for (const f of m.family()) covered.add(f);
    this.mobjects = this.mobjects.filter((m) => !covered.has(m));
    const present = new Set<Mobject>();
    for (const top of this.mobjects) for (const f of top.family()) present.add(f);
    const roots: Mobject[] = [];
    for (const m of mobs) {
      if (present.has(m)) continue;
      for (let i = roots.length - 1; i >= 0; i--) if (m.family().includes(roots[i]!)) roots.splice(i, 1);
      roots.push(m);
      for (const f of m.family()) present.add(f);
    }
    this.mobjects.push(...roots);
    return this;
  }

  /**
   * Remove mobjects from the scene. Removing a group also removes any of its
   * descendants that are on screen in their own right, so
   * `new FadeOut(new Group(a, b))` clears a and b even though the group
   * itself was never added.
   */
  remove(...mobs: Mobject[]): this {
    const gone = new Set(mobs.flatMap((m) => m.family()));
    this.mobjects = this.mobjects.filter((m) => !gone.has(m));
    // Also detach from any group on screen
    for (const m of mobs) if (m.parent) m.parent.remove(m);
    return this;
  }

  replace(old: Mobject, ...replacements: Mobject[]): this {
    const i = this.mobjects.indexOf(old);
    if (i < 0) { this.add(...replacements); return this; }
    this.mobjects.splice(i, 1, ...replacements);
    return this;
  }

  bringToFront(...mobs: Mobject[]): this { return this.add(...mobs); }
  bringToBack(...mobs: Mobject[]): this {
    this.mobjects = [...mobs, ...this.mobjects.filter((m) => !mobs.includes(m))];
    return this;
  }
  clear(): this { this.mobjects = []; return this; }

  // ---- frame loop --------------------------------------------------------

  async emitFrame(dt: number): Promise<void> {
    this.time += dt;
    perf.span('updaters', () => { for (const m of this.mobjects) m.update(dt); });
    this.frameCount++;
    const end = perf.begin('sink');
    await this.sink.frame(this, dt);
    end();
  }

  /** Play animations together; a trailing plain object is options: { runTime, rateFunc, lagRatio }. */
  async play(...args: Playable[] | [...Playable[], PlayOpts]): Promise<void> {
    const list: unknown[] = [...args];
    const last = list[list.length - 1];
    const opts = (last && Object.getPrototypeOf(last) === Object.prototype ? list.pop() : {}) as PlayOpts;
    const anims = list.map(prepareAnimation);
    for (const a of anims) a.setOptions(opts);
    assertDisjoint(anims);
    perf.span('anim.begin', () => this.beginAnimations(anims));
    const runTime = Math.max(...anims.map((a) => a.runTime));
    const dt = 1 / this.fps;
    const n = Math.max(1, Math.round(runTime * this.fps));
    const canSkip = this.skipUntil > this.time && !this.hasUpdaters();
    let skipped = 0;
    for (let f = 1; f <= n; f++) {
      // Same comparison SeekSink uses to drop a frame, so the first frame shown is identical
      if (canSkip && this.time + dt + 1e-9 < this.skipUntil) { this.time += dt; this.frameCount++; skipped++; continue; }
      const t = Math.min(f * dt, runTime);
      perf.span('interpolate', () => {
        for (const a of anims) {
          const alpha = Math.min(t / a.runTime, 1);
          a.interpolate(a.rateFunc(alpha));
        }
      });
      await this.emitFrame(dt);
    }
    perf.count('frames skipped', skipped);
    perf.span('anim.finish', () => { for (const a of anims) { a.finish(); a.cleanUpFromScene(this); } });
  }

  beginAnimations(anims: readonly Animation[]): void {
    const present = new Set(this.familyMembers());
    for (const a of anims) {
      a.begin();
      const mobs = a instanceof AnimationGroup ? a.mobjects : [a.mobject];
      for (const m of mobs) {
        if (m && !present.has(m)) { this.add(m); for (const f of m.family()) present.add(f); }
      }
    }
  }

  async wait(seconds = 1): Promise<void> {
    const dt = 1 / this.fps;
    const n = Math.round(seconds * this.fps);
    const canSkip = this.skipUntil > this.time && !this.hasUpdaters();
    for (let f = 0; f < n; f++) {
      if (canSkip && this.time + dt + 1e-9 < this.skipUntil) { this.time += dt; this.frameCount++; continue; }
      await this.emitFrame(dt);
    }
  }
}
