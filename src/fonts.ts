// Shapers for the embedded fonts, built on the vendored glyph shaper.
// The fonts (Inter, JetBrains Mono; OFL) are subset by tools/fonts.sh into
// src/font-data.ts: Latin-1, punctuation, arrows, math, shapes. The mono face
// carries no ligature lookups, so code reads as literal source, like a diff.
import { loadFont, run } from '../vendor/glyph.js';
import type { Run } from '../vendor/glyph.js';
import { SANS, MONO } from './font-data.ts';
import { perf } from './perf.ts';

const FONTS = { sans: SANS, mono: MONO };

/** The embedded faces. */
export type FontName = keyof typeof FONTS;
/** Shape `text` at `size` scene units: glyph outlines and advances. Memoized. */
export type Shaper = (text: string, size: number) => Run;

function bytesOf(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let loading: Promise<Record<FontName, Shaper>> | null = null;
let shapers: Record<FontName, Shaper> | null = null;

/**
 * Decode the embedded fonts (once; concurrent callers share one decode).
 * Scene.run() calls this, so scenes never need to.
 */
export function loadFonts(): Promise<Record<FontName, Shaper>> {
  loading ??= buildShapers().then((s) => (shapers = s));
  return loading;
}

/** The shaper for 'sans' or 'mono'. Throws if fonts haven't been loaded. */
export function shaperFor(font: FontName): Shaper {
  if (!shapers) throw new Error('Fonts are not loaded: await loadFonts() first (Scene.run() does this for scenes)');
  // === against the two faces: a prototype key, or an object whose toString is 'sans', is unknown
  switch (font) {
    case 'sans': return shapers.sans;
    case 'mono': return shapers.mono;
    default: throw new Error("Unknown font: use 'sans' or 'mono'");
  }
}

async function buildShapers(): Promise<Record<FontName, Shaper>> {
  const end = perf.begin('fonts.decode');
  const out: Partial<Record<FontName, Shaper>> = {};
  for (const [key, b64] of Object.entries(FONTS) as Array<[FontName, string]>) {
    const r = await loadFont(bytesOf(b64));
    if (r.tag !== 'Ok') throw new Error(key + ': ' + JSON.stringify(r.error));
    const font = r.value;
    // Shaping is a pure function of (font, text, size): memoize it. Re-running a
    // scene (every seek does) then costs no shaping at all, and identical
    // segment arrays let Text reuse its flattened outlines.
    const memo = new Map<string, Run>();
    out[key] = (text, size) => {
      const k = size + '\u0000' + text;
      let r = memo.get(k);
      if (r) return r;
      const ru = run(font, key, text, size);
      if (ru.tag !== 'Ok') throw new Error('shape: ' + JSON.stringify(ru.error));
      memo.set(k, (r = ru.value));
      return r;
    };
  }
  end();
  // Both keys of FONTS were filled above
  return out as Record<FontName, Shaper>;
}
