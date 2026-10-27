// Strict SVG oracle: XML 1.0 characters, a real XML parse, and an allowlist of
// tags and attributes. Background and width must round-trip. `paints: 'hex'`
// also requires path fill and stroke to be #rrggbb or none.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const PY = new URL('./svg_oracle.py', import.meta.url).pathname;

export interface SvgExpect {
  width: number;
  background: string;
  paints?: 'hex' | 'any';
}

function ask(svgs: readonly string[], expect: SvgExpect): string[] {
  const paints = expect.paints ?? 'any';
  const input = svgs.map((svg) => JSON.stringify({ svg, width: expect.width, background: expect.background, paints })).join('\n') + '\n';
  const run = spawnSync('python3', [PY], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr || run.error?.message || 'xml oracle failed to run');
  return run.stdout.trim().split('\n');
}

/** The oracle's reply for one frame: `ok`, or `error: ...`. */
export function explainSvg(svg: string, expect: SvgExpect): string {
  return ask([svg], expect)[0] ?? 'error: no reply';
}

export function assertSvg(svg: string, expect: SvgExpect): void {
  const ans = explainSvg(svg, expect);
  assert.equal(ans, 'ok', ans);
}

export function assertSvgs(svgs: readonly string[], expect: SvgExpect): void {
  if (svgs.length === 0) return;
  const lines = ask(svgs, expect);
  assert.equal(lines.length, svgs.length, `oracle replied ${lines.length} times for ${svgs.length} frames`);
  const bad = lines.findIndex((line) => line !== 'ok');
  assert.equal(bad, -1, bad < 0 ? '' : `frame ${bad}: ${lines[bad]}`);
}
