// Layout verifier: the built player at phone, tablet and desktop widths, every
// scene, every step. Fails if the page is wider than the screen (horizontal
// scroll), or the stage or transport is not fully on screen.
//   npm run verify:layout -- [scene ...] [--html=out/demo.html]
import { launch } from './lib/browser.ts';
import { SCENES } from '../scenes/index.ts';
import { requireScene } from './scene.ts';
import { traceScene } from '../src/index.ts';

const args = process.argv.slice(2);
const html = new URL('../' + (args.find((a) => a.startsWith('--html='))?.slice(7) ?? 'out/demo.html'), import.meta.url).pathname;
const names = args.filter((a) => !a.startsWith('--'));
const VIEWPORTS: Array<[width: number, height: number, label: string]> = [[375, 812, 'phone'], [390, 844, 'phone+'], [768, 1024, 'tablet'], [1280, 800, 'desktop']];
const browser = await launch();
const problems: string[] = [];
let checked = 0;
for (const name of names.length ? names : Object.keys(SCENES)) {
  const { steps } = await traceScene(requireScene(name).Scene);
  for (const [w, h, label] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    for (const s of steps) {
      await page.goto(`file://${html}?scene=${name}&step=${s.step}`);
      await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400); // let it play into the step: a step change must not move the page
      await page.evaluate(() => document.querySelector<HTMLElement>('[aria-label="Play/Pause"]')?.click());
      await page.waitForTimeout(120);
      const r = await page.evaluate(() => {
        const de = document.documentElement;
        const box = (sel: string) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; };
        const wide = [...document.querySelectorAll('body *')].filter((e) => !e.closest('svg') && e.getBoundingClientRect().right > de.clientWidth + 1).slice(0, 3)
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} (${Math.round(e.getBoundingClientRect().right)}px)`);
        return { scroll: de.scrollWidth, client: de.clientWidth, stage: box('.stage'), transport: box('.transport'), wide, scrollY: window.scrollY, railScroll: getComputedStyle(document.querySelector('.steps')!).overflowY };
      });
      checked++;
      const where = `${name} @${s.step} ${label} ${w}px`;
      if (r.scroll > r.client + 1) problems.push(`${where}: page is ${r.scroll}px wide, screen ${r.client}px; widest: ${r.wide.join(', ')}`);
      if (r.scrollY > 0) problems.push(`${where}: the player scrolled the page by itself (${Math.round(r.scrollY)}px), carrying the stage off screen`);
      for (const k of ['stage', 'transport'] as const) { const b = r[k]; if (b && (b.l < -1 || b.r > r.client + 1)) problems.push(`${where}: ${k} off screen (${Math.round(b.l)}..${Math.round(b.r)})`); }
    }
    await page.close();
  }
}
await browser.close();
if (problems.length) { console.log(`${problems.length} layout problem(s) in ${checked} checks:\n  ` + [...new Set(problems)].slice(0, 25).join('\n  ')); process.exit(1); }
console.log(`layout ok: ${checked} step views across ${VIEWPORTS.map((v) => v[0] + 'px').join(', ')}`);
