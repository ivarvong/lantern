// Build the player into single-file pages:
//   out/site/index.html   Worker static asset (vite.config.ts publicDir, served by cf build / cf deploy)
//   out/demo.html         same page, open directly
//   out/artifact.html     same page without the document skeleton (claude.ai artifact)
//   --only=<scene>        one scene as its own page: out/<scene>.html and out/<scene>.artifact.html
// esbuild is a build-time tool only; the runtime has no dependencies.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? null;
const SCENE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Pages for --only, both under out/. A name that is not a scene token is refused. */
function onlyPages(name: string): { html: string; artifact: string } {
  if (!SCENE_NAME.test(name)) {
    console.error('build --only expects a scene name of letters, digits, "_" and "-"');
    process.exit(1);
  }
  const dir = resolve(root, 'out');
  const html = resolve(dir, `${name}.html`);
  const artifact = resolve(dir, `${name}.artifact.html`);
  for (const file of [html, artifact]) {
    const rel = relative(dir, file);
    if (rel.startsWith('..') || rel.split(sep).includes('..')) {
      console.error('build output must stay inside out/');
      process.exit(1);
    }
  }
  return { html, artifact };
}

const only = onlyArg == null ? null : onlyArg;
const pages = only == null ? null : onlyPages(only);
const t0 = performance.now();
const result = await build({
  entryPoints: [root + 'app/main.ts'],
  // The app project's compiler options (class fields with define semantics, as Node runs them)
  tsconfig: root + 'tsconfig.app.json',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  minify: process.argv.includes('--minify'), write: false, legalComments: 'none',
  define: { __ONLY__: JSON.stringify(only) },
});
const js = result.outputFiles[0]!.text.replace(/<\/script/g, '<\\/script');
const css = readFileSync(root + 'app/player.css', 'utf8');
// The page loads ./main.js: the dev server serves app/main.ts under that name, the build inlines the bundle
const html = readFileSync(root + 'app/index.html', 'utf8')
  .replace('<link rel="stylesheet" href="./player.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="./main.js"></script>', () => `<script type="module">${js}</script>`);
// The artifact is hosted elsewhere, so its guide points at the deployed Worker (app/guide.ts)
const artifact = '<title>lantern: animated, steppable code explainers</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' +
  '<meta name="lantern:api" content="https://lantern.ivar.workers.dev">\n' +
  html.slice(html.indexOf('<link rel="preconnect"'), html.indexOf('</head>')) +
  html.slice(html.indexOf('<main>'), html.indexOf('</body>'));
mkdirSync(root + 'out/site', { recursive: true });
if (pages) {
  writeFileSync(pages.html, html);
  writeFileSync(pages.artifact, artifact);
  console.log(`built in ${(performance.now() - t0).toFixed(0)} ms: out/${only}.html ${(html.length / 1024).toFixed(0)} KB`);
} else {
  writeFileSync(root + 'out/site/index.html', html);
  writeFileSync(root + 'out/demo.html', html);
  writeFileSync(root + 'out/artifact.html', artifact);
  console.log(`built in ${(performance.now() - t0).toFixed(0)} ms: out/demo.html ${(html.length / 1024).toFixed(0)} KB`);
}
