// The dev server listens on loopback, answers a bad percent-escape with 400,
// refuses dotfiles, and stays up when a handler throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      server.close(() => resolve(addr.port));
    });
  });
}

function raw(port: number, path: string): Promise<{ status: number; body: string }> {
  const req = `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`;
  return new Promise((resolve, reject) => {
    // Leave the write side open until the server finishes. Ending it here aborts a slow reply.
    const socket = connect({ port, host: '127.0.0.1' }, () => { socket.write(req); });
    const chunks: Buffer[] = [];
    socket.on('data', (d) => chunks.push(d));
    socket.on('error', reject);
    socket.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const [head, body = ''] = text.split('\r\n\r\n');
      resolve({ status: Number(head?.split(' ')[1] ?? 0), body });
    });
  });
}

function listeners(port: number): string[] {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const found: string[] = [];
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.trim().split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      const [ip, p] = (cols[1] ?? '').split(':');
      if (p?.toUpperCase() === hex && cols[3] === '0A' && ip) found.push(ip);
    }
  }
  return found;
}

async function untilOk(port: number): Promise<void> {
  const deadline = Date.now() + 8000;
  let last = 'not up';
  while (Date.now() < deadline) {
    try {
      const res = await raw(port, '/');
      if (res.status === 200) return;
      last = String(res.status);
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
    throw new Error(`dev server did not answer 200 (${last})`);
}

test('dev server stays on loopback and refuses dotfiles and bad escapes', async () => {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ['tools/dev.ts', '--port', String(port)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const broken = new URL('../src/zz-dev-server-broken.ts', import.meta.url).pathname;
  let stderr = '';
  let stdout = '';
  child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
  child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
  try {
    try { await untilOk(port); } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : e}\nstdout:${stdout}\nstderr:${stderr}\nexit:${child.exitCode}`);
    }
    const bound = listeners(port);
    assert.ok(bound.includes('0100007F'), `listeners ${bound.join(',')}`);
    assert.equal(bound.includes('00000000'), false, `listeners ${bound.join(',')}`);
    assert.equal(bound.some((ip) => /^0+$/.test(ip)), false, `listeners ${bound.join(',')}`);

    const bad = await raw(port, '/%');
    assert.equal(bad.status, 400, bad.body);
    assert.equal((await raw(port, '/%zz')).status, 400);
    const head = await raw(port, '/.git/HEAD');
    assert.equal(head.status, 403, head.body);
    assert.equal(head.body.includes('ref:'), false);
    assert.equal((await raw(port, '/.gitignore')).status, 403);
    const home = await raw(port, '/');
    assert.equal(home.status, 200, stderr);
    assert.match(home.body, /<base href="\/app\/">/);

    writeFileSync(broken, 'export const x: =\n');
    const boom = await raw(port, '/src/zz-dev-server-broken.ts');
    assert.equal(boom.status, 500, boom.body);
    assert.equal(boom.body, 'internal error');
    assert.equal((await raw(port, '/')).status, 200);
    assert.equal(child.exitCode, null);
  } finally {
    rmSync(broken, { force: true });
    child.kill('SIGTERM');
    await new Promise((r) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); r(undefined); }, 1000);
      child.once('exit', () => { clearTimeout(timer); r(undefined); });
    });
  }
});
