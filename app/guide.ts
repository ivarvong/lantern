// The homepage guide (static in index.html): points its example URLs at the API
// origin, keeps them on the player's current scene and step (the player fires
// "lantern:step"), lists the scenes, and adds copy buttons.
import { sceneByName } from '../scenes/index.ts';

const PROD = 'https://lantern.ivar.workers.dev';
// Pages served by the Worker call their own origin; file:// pages, and hosts that set
// <meta name="lantern:api"> (the artifact build, the dev server), call the deployed one.
const meta = document.querySelector<HTMLMetaElement>('meta[name="lantern:api"]');
const API = meta?.content || (/^https?:$/.test(location.protocol) ? location.origin : PROD);

/** `names`: the scenes the player offers. */
export function mountGuide(root: HTMLElement | null, names: string[]): void {
  if (!root) return;
  const show = (path: string): string => API + path;
  for (const el of root.querySelectorAll('[data-origin]')) el.textContent = API;
  for (const a of root.querySelectorAll<HTMLElement>('a[data-api]:not(.ex)')) a.setAttribute('href', show(a.dataset.api!));

  // Examples: one row each, the URL as a link plus a copy button
  const examples = [...root.querySelectorAll<HTMLAnchorElement>('a.ex')].map((a) => {
    const el = a;
    const copy = document.createElement('button');
    copy.className = 'toggle copy'; copy.textContent = 'Copy'; copy.title = 'Copy this URL';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(el.href); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Select it'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
    });
    el.after(copy);
    return { el, template: el.dataset.api ?? '' };
  });
  let scene: string | null = null, step: string | null = null;
  const fill = () => {
    for (const { el, template } of examples) {
      // Before the player reports a step, keep the static example (a real step of the first scene)
      if (template.includes('{step}') && !step) continue;
      if (template.includes('{scene}') && !scene) continue;
      const path = template.replace('{scene}', encodeURIComponent(scene!)).replace('{step}', encodeURIComponent(step!));
      el.href = show(path);
      // Each example link wraps its URL in one child element (index.html)
      el.firstElementChild!.textContent = show(path);
    }
  };
  // Make the static examples absolute before the first step arrives
  for (const { el } of examples) { el.href = show(el.getAttribute('href')!); el.firstElementChild!.textContent = el.href; }
  document.addEventListener('lantern:step', (e) => {
    ({ scene, step } = (e as CustomEvent<{ scene: string; step: string }>).detail);
    fill();
  });

  // Scenes: name, label, and its four API views
  const card = root.querySelector<HTMLElement>('.scenes');
  const body = root.querySelector('.scene-table tbody');
  if (card && body) {
    const link = (path: string, label: string): HTMLAnchorElement => {
      const a = document.createElement('a');
      a.href = show(path); a.textContent = label; a.className = 'chip';
      return a;
    };
    for (const name of names) {
      const entry = sceneByName(name);
      if (!entry) continue;
      const q = `?scene=${encodeURIComponent(name)}`;
      const tr = document.createElement('tr');
      const nameCell = document.createElement('td'), what = document.createElement('td'), api = document.createElement('td');
      const code = document.createElement('code'); code.textContent = name; nameCell.append(code);
      what.textContent = entry.label;
      api.append(link(`/index.json${q}`, 'steps'), link(`/trace.json${q}`, 'trace'), link(`/text${q}`, 'text'), link(`/frame.svg${q}`, 'svg'));
      tr.append(nameCell, what, api);
      body.append(tr);
    }
    card.hidden = false;
  }
}
