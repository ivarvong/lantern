// Dev server: serves the source tree as native ES modules (no bundle), and
// reloads the page when src/, app/ or scenes/ change. The player keeps
// ?scene=&step= in the URL, so a reload lands on the step you were watching.
// TypeScript files are served as JavaScript, types stripped per file by
// esbuild's transform; the page's ./main.js is app/main.ts.
// Listens on 127.0.0.1. Dotfiles (including .git) are not served.
//   npm run dev [-- --port 5173]
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch, existsSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { transform } from 'esbuild';

const root = new URL('../', import.meta.url).pathname;
const HOST = '127.0.0.1';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5173;
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const RELOAD = `<script type="module">new EventSource('/__reload').onmessage = () => location.reload();</script>`;
const clients = new Set<ServerResponse>();
// What tsc and Node assume: define-semantics class fields, imports kept as written
const TSCONFIG = { compilerOptions: { useDefineForClassFields: true, verbatimModuleSyntax: true } };

function send(res: ServerResponse, status: number, body: Buffer | string, type: string): void {
  if (res.headersSent || res.writableEnded) { res.end(); return; }
  const payload = typeof body === 'string' ? Buffer.from(body) : body;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-length': payload.length });
  res.end(payload);
}

function text(res: ServerResponse, status: number, body: string): void {
  send(res, status, body, 'text/plain; charset=utf-8');
}

/** A repo-relative path with no dot segments, or null when it must not be served. */
function serveRel(pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const rel = decoded === '/' ? 'app/index.html' : decoded.replace(/^\/+/, '');
  if (rel === '' || rel.includes('\0')) return null;
  const file = resolve(root, rel);
  const under = relative(root, file);
  if (under.startsWith('..') || under.startsWith(sep) || under === '') return null;
  for (const part of under.split(sep)) {
    if (part === '' || part === '.' || part === '..' || part.startsWith('.')) return null;
  }
  return under;
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let url: URL;
  try { url = new URL(req.url ?? '/', `http://${HOST}`); }
  catch { text(res, 400, 'bad request'); return; }
  if (url.pathname === '/__reload') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let rel: string | null;
  try { rel = serveRel(url.pathname); } catch { text(res, 400, 'bad request'); return; }
  if (rel == null) {
    // decodeURIComponent throws inside serveRel and returns null for a bad escape
    // and for a refused path. A '%' that does not decode is a 400; anything else is 403.
    let bad = false;
    try { decodeURIComponent(url.pathname); } catch { bad = true; }
    text(res, bad ? 400 : 403, bad ? 'bad request' : 'forbidden');
    return;
  }
  let file = normalize(join(root, rel));
  const again = relative(root, file);
  if (again.startsWith('..') || again.startsWith(sep)) { text(res, 403, 'forbidden'); return; }
  // A .js that is not there is its .ts source (index.html loads ./main.js)
  if (file.endsWith('.js') && !existsSync(file) && existsSync(file.slice(0, -3) + '.ts')) file = file.slice(0, -3) + '.ts';
  let body: Buffer | string;
  try {
    if ((await stat(file)).isDirectory()) { text(res, 404, 'not found'); return; }
    body = await readFile(file);
  } catch (e) {
    if (isEnoent(e)) { text(res, 404, 'not found'); return; }
    throw e;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  if (rel === 'app/index.html') {
    // Served from "/", so point the page's relative URLs at app/; the guide's API
    // examples point at the deployed Worker, since this server has no API
    body = body.toString().replace('<head>', '<head>\n<base href="/app/">\n<meta name="lantern:api" content="https://lantern.ivar.workers.dev">').replace('</body>', `${RELOAD}\n</body>`);
  }
  if (file.endsWith('.ts')) {
    // Imports keep their .ts specifiers: the browser requests them, and they come back here
    body = (await transform(body.toString(), { loader: 'ts', format: 'esm', target: 'es2022', sourcemap: 'inline', sourcefile: rel, tsconfigRaw: TSCONFIG })).code;
  }
  send(res, 200, body, type);
}

const server = createServer((req, res) => {
  handle(req, res).catch(() => text(res, 500, 'internal error'));
});
server.on('clientError', (_err, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});
server.listen(port, HOST, () => console.log(`dev: http://${HOST}:${port}/?scene=pyex-limits  (reloads on save)`));

let pending: ReturnType<typeof setTimeout> | undefined;
for (const dir of ['src', 'app', 'scenes']) {
  watch(join(root, dir), { recursive: true }, (_, name) => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      console.log(`changed ${dir}/${name}: reloading ${clients.size} page(s)`);
      for (const c of clients) c.write('data: reload\n\n');
    }, 50);
  });
}
