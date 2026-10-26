// Player: scene picker, transport (play/pause, prev/next step, scrubber with
// step markers), a step rail showing each step's state diff, keyboard
// shortcuts, copy-link. Deep links: ?scene=x&step=y or ?t=12.5
// (#x.y as a fallback for hosts that strip the query string). Each step change
// fires "lantern:step" ({ scene, step }) on document, for the guide.
import { DomSink, SeekSink, stepTime, traceScene, perf } from '../src/index.ts';
import type { Scene, SceneIndex, Sink, Step, StepMeta, Trace } from '../src/index.ts';
import { SCENES as ALL_SCENES } from '../scenes/index.ts';
import type { SceneEntry } from '../scenes/index.ts';

/** esbuild's define (tools/build.ts): the one scene of a --only build, or null; undefined in dev. */
declare const __ONLY__: string | null | undefined;

// A build with --only=<scene> (tools/build.ts) ships one scene as its own page
const ONLY = typeof __ONLY__ !== 'undefined' ? __ONLY__ : null;
const ONLY_ENTRY = ONLY ? ALL_SCENES[ONLY] : undefined;
const SCENES: Record<string, SceneEntry> = ONLY && ONLY_ENTRY ? { [ONLY]: ONLY_ENTRY } : ALL_SCENES;
export const sceneNames = () => Object.keys(SCENES);

const fmt = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function readLink(): { scene: string | null; step: string | null; t: number | null } {
  const q = new URLSearchParams(location.search);
  let scene: string | null | undefined = q.get('scene'), step: string | null | undefined = q.get('step');
  const t = q.get('t');
  if (!scene && location.hash.length > 1) [scene, step] = location.hash.slice(1).split('.');
  return { scene: String(scene) in SCENES ? scene! : null, step: step ?? null, t: t == null ? null : Number(t) };
}

function linkFor(scene: string, step: string | null): URL {
  const url = new URL(location.href);
  url.search = ''; url.hash = '';
  url.searchParams.set('scene', scene);
  if (step) url.searchParams.set('step', step);
  return url;
}

/** Attributes for h(): `class`, `on<event>` listeners, and plain attributes (null skips). */
type Attrs = Record<string, string | EventListener | null | undefined>;
type Kid = Node | string | null | undefined;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<Kid | Kid[]>): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v as string;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (v != null) el.setAttribute(k, v as string);
  }
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
};

export function mountPlayer(root: HTMLElement): void {
  if (root.dataset.mounted) return; // guard against double mounting
  root.dataset.mounted = '1';
  // ?perf=1 traces startup and the first seconds of playback to the console
  const tracing = new URLSearchParams(location.search).get('perf') === '1';
  if (tracing) {
    perf.enable({ timelineDepth: 2 });
    Object.assign(window, { __perf: perf });
    setTimeout(() => { console.log(perf.report()); perf.disable(); }, 8000);
  }
  // Web fonts load after the player starts instead of blocking module execution
  if (!document.querySelector('link[data-ui-fonts]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.dataset.uiFonts = '';
    l.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';
    document.head.append(l);
  }

  // ---- DOM -------------------------------------------------------------------
  const sceneSelect = h('select', { class: 'scene-select', 'aria-label': 'Scene' });
  const sceneTabs = h('div', { class: 'scene-tabs', role: 'tablist' });
  const stageInner = h('div', { class: 'stage-svg' });
  const scrubFill = h('div', { class: 'scrub-fill' });
  const scrubMarks = h('div', { class: 'scrub-marks' });
  const scrubber = h('div', { class: 'scrubber', role: 'slider', tabindex: '0', 'aria-label': 'Timeline' }, scrubMarks, scrubFill);
  const timeEl = h('span', { class: 'time' }, '0:00.0 / 0:00.0');
  const playBtn = h('button', { class: 'icon', 'aria-label': 'Play/Pause', title: 'Play / pause (space)' }, icon('pause'));
  const prevBtn = h('button', { class: 'icon', 'aria-label': 'Previous step', title: 'Previous step (←)' }, icon('prev'));
  const nextBtn = h('button', { class: 'icon', 'aria-label': 'Next step', title: 'Next step (→)' }, icon('next'));
  const stepMode = h('button', { class: 'toggle', 'aria-pressed': 'false', title: 'Pause at every step (s)' }, 'Step mode');
  const copyBtn = h('button', { class: 'toggle', title: 'Copy link to this step (c)' }, 'Copy link');
  const stepRail = h('ol', { class: 'steps' });
  const stepTitle = h('div', { class: 'step-title' });
  const stepDiff = h('div', { class: 'step-diff' });
  const captionEl = h('div', { class: 'caption', 'aria-live': 'polite' });
  const toast = h('div', { class: 'toast', role: 'status' });
  // A button, not a #guide link: the dev server's <base href> would resolve an anchor to /app/
  const guide = document.getElementById('guide');
  const guideBtn = guide && h('button', { class: 'toggle guide-btn', title: 'How to use lantern', onclick: () => guide.scrollIntoView({ behavior: 'smooth' }) }, 'How to use');

  root.replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }), 'lantern'),
      sceneTabs, sceneSelect, guideBtn),
    h('section', { class: 'player' },
      h('div', { class: 'stage' }, stageInner),
      captionEl,
      h('div', { class: 'transport' }, prevBtn, playBtn, nextBtn, scrubber, timeEl)),
    h('section', { class: 'panel' },
      h('div', { class: 'now' },
        h('div', { class: 'now-head' }, stepTitle, h('div', { class: 'actions' }, stepMode, copyBtn)),
        stepDiff),
      stepRail),
    toast,
  );

  // ---- state -------------------------------------------------------------------
  const link = readLink();
  // The registry is never empty
  let current = link.scene ?? Object.keys(SCENES)[0]!;
  let generation = 0;
  // Set by play() before anything reads them
  let index: SceneIndex = null!, trace: Trace = null!;
  let paused = false, pauseAtSteps = false;
  let resume: (() => void) | null = null;
  let activeStep: string | null = null, lastTime = 0;
  const cache: Record<string, { ix: SceneIndex; tr: Trace }> = {};

  if (ONLY) root.classList.add('single');
  for (const [key, { label }] of Object.entries(SCENES)) {
    sceneSelect.append(h('option', { value: key }, label));
    sceneTabs.append(h('button', { role: 'tab', class: 'tab', 'data-scene': key, onclick: () => selectScene(key) }, label));
  }
  sceneSelect.addEventListener('change', () => selectScene(sceneSelect.value));

  function selectScene(key: string): void { if (key !== current) { current = key; play(); } }

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function say(msg: string): void {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
  }

  async function load(key: string): Promise<{ ix: SceneIndex; tr: Trace }> {
    if (!cache[key]) {
      const { Scene } = SCENES[key]!;
      // One run gives both: the trace's step records carry everything the index has
      const end = perf.begin('load.trace');
      const tr = await traceScene(Scene);
      end();
      const ix: SceneIndex = { fps: tr.fps, duration: tr.duration, frames: tr.frames,
        steps: tr.steps.map((s) => ({ name: s.step.split('/').pop()!, path: s.step, t0: s.t0, t1: s.t1 ?? null, frame0: s.frame0, frame1: s.frame1 ?? null, meta: s.meta })) };
      cache[key] = { ix, tr };
    }
    return cache[key];
  }

  // ---- rendering the chrome --------------------------------------------------------
  function renderSteps(): void {
    stepRail.replaceChildren(...index.steps.map((s, i) => h('li', {},
      h('button', { class: 'step', 'data-step': s.name, onclick: () => play({ step: s.name }) },
        h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'name' }, s.name, h('span', { class: 'meta' }, metaChips(s.meta)),
          s.meta?.caption ? h('span', { class: 'cap' }, String(s.meta.caption)) : null),
        h('span', { class: 'at' }, fmt(s.t0))))));
    scrubMarks.replaceChildren(...index.steps.slice(1).map((s) =>
      h('i', { style: `left:${(100 * s.t0 / index.duration).toFixed(2)}%`, title: s.name })));
  }

  function metaChips(meta: StepMeta | undefined): HTMLElement[] {
    return Object.entries(meta ?? {}).filter(([k]) => k !== 'note' && k !== 'caption').slice(0, 3)
      .map(([k, v]) => h('span', { class: 'chip' }, `${k}: ${v}`));
  }

  function setActive(name: string | null): void {
    if (name === activeStep) return;
    activeStep = name;
    for (const b of stepRail.querySelectorAll<HTMLElement>('.step')) {
      const on = b.dataset.step === name;
      b.setAttribute('aria-current', on ? 'step' : 'false');
      // Keep the active step visible inside the rail when the rail scrolls on its own
      // (desktop). Never scroll the page: on a phone the rail is part of the page, and
      // following the steps would carry the stage off screen while it plays.
      if (on && stepRail.scrollHeight > stepRail.clientHeight + 1) {
        const top = b.offsetTop - stepRail.offsetTop, bottom = top + b.offsetHeight;
        if (top < stepRail.scrollTop) stepRail.scrollTop = top;
        else if (bottom > stepRail.scrollTop + stepRail.clientHeight) stepRail.scrollTop = bottom - stepRail.clientHeight;
      }
    }
    const t = trace.steps.find((s) => s.step === name);
    const i = index.steps.findIndex((s) => s.name === name);
    stepTitle.replaceChildren(
      h('span', { class: 'kicker' }, i >= 0 ? `Step ${String(i + 1).padStart(2, '0')} / ${String(index.steps.length).padStart(2, '0')}` : 'Step'),
      h('b', {}, name ?? '—'));
    stepDiff.replaceChildren(...diffRows(t?.before ?? {}, t?.after ?? {}));
    if (t?.meta?.note) stepDiff.append(h('span', { class: 'note' }, String(t.meta.note)));
    captionEl.textContent = (t?.meta?.caption as string | undefined) ?? '';
    captionEl.classList.toggle('on', !!t?.meta?.caption);
    if (name) history.replaceState?.(null, '', linkFor(current, name));
    if (name) document.dispatchEvent(new CustomEvent('lantern:step', { detail: { scene: current, step: name } }));
  }

  function diffRows(before: Record<string, unknown>, after: Record<string, unknown>): HTMLElement[] {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const rows: HTMLElement[] = [];
    for (const k of keys) {
      const a = JSON.stringify(before[k]), b = JSON.stringify(after[k]);
      if (a === b) continue;
      // Long values (arrays) are truncated in place; the full value is on hover
      rows.push(h('span', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'old', title: a ?? '' }, a ?? '∅'), h('span', { class: 'arr' }, '→'), h('span', { class: 'new', title: b ?? '' }, b ?? '∅')));
    }
    return rows.length ? rows : [h('span', { class: 'kv quiet' }, 'no state change in this step')];
  }

  function setTime(t: number): void {
    lastTime = t;
    scrubFill.style.width = `${(100 * t / index.duration).toFixed(2)}%`;
    timeEl.textContent = `${fmt(t)} / ${fmt(index.duration)}`;
    scrubber.setAttribute('aria-valuenow', t.toFixed(1));
  }

  function setPaused(p: boolean): void {
    paused = p;
    playBtn.replaceChildren(icon(p ? 'play' : 'pause'));
    root.classList.toggle('paused', p);
    if (!p && resume) { const r = resume; resume = null; r(); }
  }

  // ---- playback --------------------------------------------------------------------
  async function play({ step = null, t = null }: { step?: string | null; t?: number | null } = {}): Promise<void> {
    const gen = ++generation;
    root.classList.remove('ended');
    setPaused(false); // also releases a run parked on the pause promise so it can abort
    for (const b of sceneTabs.children as HTMLCollectionOf<HTMLElement>) b.setAttribute('aria-selected', String(b.dataset.scene === current));
    sceneSelect.value = current;
    root.classList.add('loading');
    const { ix, tr } = await load(current);
    if (gen !== generation) return;
    index = ix; trace = tr;
    renderSteps();
    const startAt = t ?? (step ? stepTime(index, step) ?? 0 : 0);
    activeStep = null;
    setTime(startAt);
    stageInner.replaceChildren();
    const dom = new DomSink(stageInner, { background: '#0a0a0a' });
    const seek = new SeekSink(dom, startAt);
    const endSeek = perf.begin('seek.run');
    let firstLive = true;
    // The player's sink: seek to startAt, then drive the UI from each live frame
    const sink: Sink = {
      async frame(scene: Scene, dt: number) {
        if (gen !== generation) throw new Abort();
        if (scene.time + 1e-9 >= startAt) {
          if (firstLive) { firstLive = false; root.classList.remove('loading'); endSeek(); }
          setTime(scene.time);
          setActive(scene.currentStep?.name ?? activeStep);
          if (paused) await new Promise<void>((r) => { resume = r; });
          if (gen !== generation) throw new Abort();
        }
        await seek.frame(scene, dt);
      },
      async stepBegin(scene: Scene, s: Step) {
        if (scene.time + 1e-9 < startAt) return;
        setActive(s.name);
        // Step mode: hold at the boundary of every step after the one we started in
        if (pauseAtSteps && !firstLive && Math.abs(scene.time - startAt) > 1e-6) setPaused(true);
      },
    };
    const { Scene } = SCENES[current]!;
    const scene = new Scene(sink, { fps: 30, skipUntil: startAt });
    stageInner.classList.toggle('portrait', scene.frame.h > scene.frame.w);
    try { await scene.run(); } catch (e) { if (!(e instanceof Abort)) throw e; return; }
    if (gen === generation) { setTime(index.duration); setPaused(true); root.classList.add('ended'); }
  }
  class Abort extends Error {}

  function stepIndexAt(t: number): number {
    let i = 0;
    index.steps.forEach((s, k) => { if (s.t0 <= t + 1e-6) i = k; });
    return i;
  }
  function gotoStep(delta: number): void {
    if (!index) return;
    const i = Math.max(0, Math.min(index.steps.length - 1, stepIndexAt(lastTime) + delta));
    root.classList.remove('ended');
    setPaused(false);
    play({ step: index.steps[i]!.name });
  }

  // ---- controls --------------------------------------------------------------------
  playBtn.addEventListener('click', () => {
    if (root.classList.contains('ended')) { root.classList.remove('ended'); setPaused(false); play(); return; }
    setPaused(!paused);
  });
  prevBtn.addEventListener('click', () => gotoStep(-1));
  nextBtn.addEventListener('click', () => gotoStep(1));
  stepMode.addEventListener('click', () => { pauseAtSteps = !pauseAtSteps; stepMode.setAttribute('aria-pressed', String(pauseAtSteps)); say(pauseAtSteps ? 'Pausing at every step' : 'Auto-advance'); });
  copyBtn.addEventListener('click', async () => {
    const url = linkFor(current, activeStep).toString();
    try { await navigator.clipboard.writeText(url); say('Link copied'); }
    catch { say(url); }
  });
  const scrubTo = (ev: MouseEvent): void => {
    const r = scrubber.getBoundingClientRect();
    // Registered for clicks; a TouchEvent would carry its point in `touches`
    const x = ((ev as MouseEvent & Partial<TouchEvent>).touches?.[0]?.clientX ?? ev.clientX) - r.left;
    const t = Math.max(0, Math.min(1, x / r.width)) * index.duration;
    root.classList.remove('ended'); setPaused(false);
    play({ t });
  };
  scrubber.addEventListener('click', scrubTo);
  scrubber.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') gotoStep(-1); if (e.key === 'ArrowRight') gotoStep(1); });
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
    if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
    else if (e.key === 'ArrowLeft') gotoStep(-1);
    else if (e.key === 'ArrowRight') gotoStep(1);
    else if (e.key === 's') stepMode.click();
    else if (e.key === 'c') copyBtn.click();
  });

  play(link.step ? { step: link.step } : link.t != null ? { t: link.t } : {});
}

function icon(name: 'play' | 'pause' | 'prev' | 'next'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true');
  const d = {
    play: 'M4 2.5v11l9-5.5z',
    pause: 'M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z',
    prev: 'M3 2.5h2v11H3zM13 2.5v11L6 8z',
    next: 'M11 2.5h2v11h-2zM3 2.5v11l7-5.5z',
  }[name];
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); svg.append(p);
  return svg;
}
