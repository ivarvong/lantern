// build --only must stay under out/. A name with a path separator is refused
// before anything is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

test('build --only refuses a name that would leave out/', () => {
  const target = join(tmpdir(), `lantern-only-${process.pid}`);
  const only = relative(join(root, 'out'), target);
  assert.match(only, /^\.\./);
  const html = target + '.html';
  const artifact = target + '.artifact.html';
  try {
    const run = spawnSync(process.execPath, ['tools/build.ts', `--only=${only}`], { cwd: root, encoding: 'utf8' });
    assert.notEqual(run.status, 0, run.stdout);
    assert.equal(existsSync(html), false);
    assert.equal(existsSync(artifact), false);
    assert.equal(existsSync(join(root, 'out', `${only}.html`)), false);
  } finally {
    rmSync(html, { force: true });
    rmSync(artifact, { force: true });
  }
});

test('build --only writes the named page under out/', { timeout: 120_000 }, () => {
  const html = join(root, 'out/lantern.html');
  const artifact = join(root, 'out/lantern.artifact.html');
  try {
    const run = spawnSync(process.execPath, ['tools/build.ts', '--only=lantern'], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(existsSync(html), true);
    assert.equal(existsSync(artifact), true);
    const page = readFileSync(html, 'utf8');
    assert.match(page, /<script type="module">/);
  } finally {
    rmSync(html, { force: true });
    rmSync(artifact, { force: true });
  }
});
