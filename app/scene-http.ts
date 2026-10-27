// HTTP boundary for a scene document.
//
// The body is read with a hard size cap, parsed as JSON, then handed to the
// scene parser. Renderers only see the branded document that comes back.
// SVG responses carry a nosniff header and a content security policy that
// allows no scripts. The API is unauthenticated and sets no cookies, so
// responses stay readable from any origin.

import { SnapshotSink, StringSink, indexScene, renderAt, renderElements, renderText, stepTime, traceScene } from '../src/index.ts';
import type { SceneClass } from '../src/index.ts';
import { SCENES, sceneByName } from '../scenes/index.ts';
import type { SceneEntry } from '../scenes/index.ts';
import { SceneRejected, compileScene } from './scene-compile.ts';
import { fail as parseFail, ok } from './result.ts';
import type { Fail, Result } from './result.ts';
import { LIMITS, parseEnvelope, parseQueryOutput, parseScene } from './scene-request.ts';
import type { Output, SceneDoc, Select } from './scene-request.ts';

export const CORS: Record<string, string> = { 'access-control-allow-origin': '*' };

const SVG_HEADERS: Record<string, string> = {
  'content-type': 'image/svg+xml',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'",
};

type Cache = 'public' | 'nostore' | 'none';

function cacheHeader(cache: Cache): Record<string, string> {
  if (cache === 'public') return { 'cache-control': 'public, max-age=3600' };
  if (cache === 'nostore') return { 'cache-control': 'no-store' };
  return {};
}

export function jsonResponse(value: unknown, status: number, cache: Cache = 'none'): Response {
  return Response.json(value, { status, headers: { ...CORS, ...cacheHeader(cache) } });
}

/** End the request. The Worker returns a thrown Response. */
export function fail(status: number, body: Record<string, unknown>, cache: Cache = 'none'): never {
  throw jsonResponse({ ...body, help: '/llms.txt' }, status, cache);
}

export function svgResponse(svg: string, cache: 'public' | 'nostore'): Response {
  return new Response(svg, { headers: { ...SVG_HEADERS, ...cacheHeader(cache), ...CORS } });
}

export function textResponse(body: string, cache: Cache): Response {
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', ...cacheHeader(cache), ...CORS } });
}

const POST_ONLY = new Set(['/render']);

export function isApiRoute(route: string): boolean {
  switch (route) {
    case '/render': case '/frame.svg': case '/text': case '/elements.json': case '/trace.json': case '/index.json':
      return true;
    default:
      return false;
  }
}

function allowMethods(route: string): string {
  return POST_ONLY.has(route) ? 'POST, OPTIONS' : 'GET, POST, OPTIONS';
}

export function preflight(route: string): Response {
  const allow = allowMethods(route);
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      allow,
      'access-control-allow-methods': allow,
      'access-control-allow-headers': 'content-type, accept',
    },
  });
}

export function methodNotAllowedResponse(route: string): Response {
  const allow = allowMethods(route);
  return new Response(JSON.stringify({ error: 'method not allowed', help: '/llms.txt' }), {
    status: 405,
    headers: { 'content-type': 'application/json', ...CORS, allow, 'access-control-allow-methods': allow },
  });
}

export function shortcutFormat(route: string): 'svg' | 'text' | 'elements' | 'trace' | 'index' | null {
  switch (route) {
    case '/frame.svg': return 'svg';
    case '/text': return 'text';
    case '/elements.json': return 'elements';
    case '/trace.json': return 'trace';
    case '/index.json': return 'index';
    default: return null;
  }
}

export function lookupScene(name: string | null): SceneEntry {
  if (name != null && name.length > 64) fail(400, { error: 'scene name is too long' });
  const entry = name == null || name.length === 0 ? undefined : sceneByName(name);
  if (!entry) fail(404, { error: 'unknown or missing scene', scenes: Object.keys(SCENES) });
  return entry;
}

function stepMessage(name: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,63}$/.test(name) ? `unknown step ${name}` : 'unknown step';
}

async function selectTime(Scene: SceneClass, select: Select): Promise<number> {
  if (select.kind === 'end') return Infinity;
  if (select.kind === 'time') return select.t;
  const index = await indexScene(Scene);
  const t = stepTime(index, select.name);
  if (t == null) fail(404, { error: stepMessage(select.name), steps: index.steps.map((s) => s.name) });
  return t;
}

export async function renderOutput(Scene: SceneClass, output: Output, cache: Cache, custom: boolean): Promise<Response> {
  const stored: Cache = cache === 'public' ? 'none' : cache;
  try {
    if (output.format === 'index') return jsonResponse(await indexScene(Scene), 200, stored);
    if (output.format === 'trace') return jsonResponse(await traceScene(Scene), 200, stored);
    if (output.format === 'frames') {
      const sink = new StringSink({ width: output.width, background: output.background });
      const scene = new Scene(sink);
      await scene.run();
      if (sink.frames.length > LIMITS.framesFormat) fail(400, { error: `frames output is limited to ${LIMITS.framesFormat} frames` }, 'nostore');
      return jsonResponse({ fps: scene.fps, width: output.width, background: output.background, frames: sink.frames }, 200, 'nostore');
    }
    const t = await selectTime(Scene, output.select);
    if (output.format === 'svg') {
      const sink = new SnapshotSink({ width: output.width, background: output.background });
      await renderAt(Scene, t, sink);
      return svgResponse(sink.svg, cache === 'public' ? 'public' : 'nostore');
    }
    const scene = await renderAt(Scene, t, { async frame() {} });
    if (output.format === 'text') return textResponse(renderText(scene), stored);
    return jsonResponse(renderElements(scene), 200, stored);
  } catch (e) {
    if (e instanceof Response) throw e;
    if (e instanceof SceneRejected) fail(400, { error: 'invalid scene', errors: e.errors }, custom ? 'nostore' : 'none');
    if (custom && e instanceof Error && e.message.startsWith('play():')) fail(400, { error: 'a play animates the same object more than once' }, 'nostore');
    if (custom) fail(400, { error: 'scene could not be rendered' }, 'nostore');
    throw e;
  }
}

async function renderDocument(doc: SceneDoc, output: Output): Promise<Response> {
  const compiled = compileScene(doc);
  if (!compiled.ok) fail(400, { error: 'invalid scene', errors: compiled.errors }, 'nostore');
  return renderOutput(compiled.value, output, 'nostore', true);
}

function invalid(errors: readonly Fail[]): never {
  fail(400, { error: 'invalid scene', errors }, 'nostore');
}

/** Read a JSON body, refusing anything larger than the scene limit. */
export async function readJson(request: Request): Promise<Result<unknown>> {
  const declared = request.headers.get('content-length');
  if (declared != null && /^\d+$/.test(declared) && Number(declared) > LIMITS.bodyBytes) {
    return parseFail('body', `body exceeds ${LIMITS.bodyBytes} bytes`);
  }
  if (!request.body) return parseFail('body', 'expected a JSON body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const value = next.value;
    if (!value) continue;
    total += value.byteLength;
    if (total > LIMITS.bodyBytes) {
      await reader.cancel();
      return parseFail('body', `body exceeds ${LIMITS.bodyBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return parseFail('body', 'body is not utf-8'); }
  try { return ok(JSON.parse(text) as unknown); }
  catch { return parseFail('body', 'body is not JSON'); }
}

export async function handlePost(request: Request, route: string): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) {
    const tooBig = body.errors.some((e) => e.message.startsWith('body exceeds'));
    fail(tooBig ? 413 : 400, { error: tooBig ? 'body too large' : 'invalid scene', errors: body.errors }, 'nostore');
  }
  if (route === '/render') {
    const envelope = parseEnvelope(body.value);
    if (!envelope.ok) invalid(envelope.errors);
    return renderDocument(envelope.value.scene, envelope.value.output);
  }
  const format = shortcutFormat(route);
  if (!format) fail(405, { error: 'method not allowed' }, 'nostore');
  const scene = parseScene(body.value);
  const output = parseQueryOutput(format, new URL(request.url).searchParams);
  if (!scene.ok || !output.ok) invalid([...(scene.ok ? [] : scene.errors), ...(output.ok ? [] : output.errors)]);
  return renderDocument(scene.value, output.value);
}

export async function handleGet(route: string, url: URL, Scene: SceneClass): Promise<Response> {
  const format = shortcutFormat(route);
  if (!format) fail(404, { error: 'unknown or missing scene' });
  const output = parseQueryOutput(format, url.searchParams);
  if (!output.ok) fail(400, { error: output.errors[0]?.message ?? 'invalid request', errors: output.errors });
  // Registered frames are cacheable. JSON and text keep the headers they had.
  return renderOutput(Scene, output.value, format === 'svg' ? 'public' : 'none', false);
}
