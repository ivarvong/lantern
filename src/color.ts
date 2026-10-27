// Colors travel through the API as hex strings and are parsed only to blend.

type RGB = [r: number, g: number, b: number];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * `#rgb` or `#rrggbb`, canonicalized to lowercase `#rrggbb`.
 * Anything else, including an object whose toString looks like a colour, is null.
 */
export function canonicalHex(value: unknown): string | null {
  if (typeof value !== 'string' || !HEX.test(value)) return null;
  const h = value.slice(1);
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
  return '#' + full.toLowerCase();
}

const cache = new Map<string, RGB>();

export function parseColor(hex: string | null | undefined): RGB | null {
  if (hex == null || hex === 'none') return null;
  let c = cache.get(hex);
  if (c) return c;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  cache.set(hex, c);
  return c;
}

const hex2 = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

export function toHex(rgb: Readonly<RGB>): string {
  return '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);
}

export function lerpColor(a: string, b: string, t: number): string {
  if (a === b) return a;
  const ca = parseColor(a), cb = parseColor(b);
  if (!ca) return t < 0.5 ? a : b;
  if (!cb) return t < 0.5 ? a : b;
  return toHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

// A small palette in manim's spirit
export const WHITE = '#ffffff';
export const BLACK = '#000000';
export const GREY = '#888888';
export const GREY_D = '#444444';
export const BLUE = '#58c4dd';
export const BLUE_D = '#29abca';
export const TEAL = '#5cd0b3';
export const GREEN = '#83c167';
export const YELLOW = '#ffff00';
export const GOLD = '#f0ac5f';
export const RED = '#fc6255';
export const MAROON = '#c55f73';
export const PURPLE = '#9a72ac';
export const ORANGE = '#ff862f';
