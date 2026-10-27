// The Worker's routes, called in-process: content negotiation on "/", the
// /llms.txt guide, the catalog, error shapes, and every example URL that the
// homepage (app/index.html) and the guide print, so the docs cannot rot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { failureResponse } from '../app/worker.ts';
import type { SceneIndex } from '../src/index.ts';
import { SCENES } from '../scenes/index.ts';

const ORIGIN = 'https://lantern.example';
const PAGE = '<!doctype html><title>player</title>';
const env = { ASSETS: { fetch: async () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }) } };
const get = (path: string, headers: Record<string, string> = {}): Promise<Response> => worker.fetch(new Request(ORIGIN + path, { headers }), env);

test('"/" serves the page to browsers and the text guide to everyone else', async () => {
  const html = await get('/?scene=lantern&step=layout', { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' });
  assert.equal(await html.text(), PAGE);
  assert.equal(html.headers.get('vary'), 'Accept');
  for (const accept of ['*/*', 'text/plain', '']) {
    const res = await get('/', accept ? { accept } : {});
    assert.match(res.headers.get('content-type')!, /^text\/plain/, accept);
    assert.equal(await res.text(), await (await get('/llms.txt')).text());
  }
});

test('/llms.txt names every scene and its steps, and its examples work', async () => {
  const txt = await (await get('/llms.txt')).text();
  for (const name of Object.keys(SCENES)) assert.match(txt, new RegExp(`^- ${name}: `, 'm'));
  assert.ok(txt.includes(`Base URL: ${ORIGIN}`));
  const urls = [...txt.matchAll(/curl '([^']+)'/g)].map((m) => m[1]!);
  assert.ok(urls.length >= 5);
  for (const u of urls) assert.equal((await get(u.slice(ORIGIN.length))).status, 200, u);
});

test('every example URL on the homepage returns 200', async () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const hrefs = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'));
  assert.ok(hrefs.length >= 6);
  for (const h of hrefs) assert.equal((await get(h)).status, 200, h);
  // the live templates (app/guide.ts fills {scene} and {step}) work for every scene's every step
  const templates = [...html.matchAll(/data-api="([^"]*)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'));
  for (const name of ['ring-buffer', 'glyph-text']) {
    const { steps } = await (await get(`/index.json?scene=${name}`)).json() as SceneIndex;
    for (const s of steps) for (const t of templates) {
      const path = t.replace('{scene}', name).replace('{step}', encodeURIComponent(s.name));
      assert.equal((await get(path)).status, 200, path);
    }
  }
});

test('/index.json without a scene is the catalog', async () => {
  const res = await get('/index.json');
  assert.equal(res.status, 200);
  const body = await res.json() as { scenes: Array<{ name: string; label: string }>; help: string };
  assert.deepEqual(body.scenes.map((s) => s.name), Object.keys(SCENES));
  assert.equal(body.help, '/llms.txt');
});

test('an unexpected throw is a 500 JSON body with no exception text', () => {
  const secret = 'scene payload should not leak';
  const res = failureResponse(new Error(secret));
  assert.equal(res.status, 500);
  assert.match(res.headers.get('content-type') ?? '', /json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  return res.text().then((text) => {
    assert.equal(text.includes(secret), false);
    assert.deepEqual(JSON.parse(text), { error: 'internal error', help: '/llms.txt' });
  });
});

test('a thrown response is returned unchanged', () => {
  const sent = new Response('kept', { status: 404 });
  assert.equal(failureResponse(sent), sent);
});

test('errors are JSON with what to try instead', async () => {
  const cases: Array<[path: string, status: number, key: string]> = [
    ['/text', 404, 'scenes'], ['/frame.svg?scene=nope', 404, 'scenes'],
    ['/text?scene=lantern&step=nope', 404, 'steps'],
    ['/text?scene=lantern&t=soon', 400, 'error'], ['/frame.svg?scene=lantern&w=wide', 400, 'error'],
  ];
  for (const [path, status, key] of cases) {
    const res = await get(path);
    assert.equal(res.status, status, path);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(body.error && body[key] && body.help === '/llms.txt', `${path}: ${JSON.stringify(body)}`);
  }
});
