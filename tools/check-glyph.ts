// CI pin for vendor/glyph.js. The bundle has no upstream revision string;
// vendor/glyph.pin.json is the checksum of the bytes we ship.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

interface Pin { file: string; bytes: number; sha256: string }

const pin = JSON.parse(readFileSync(new URL('../vendor/glyph.pin.json', import.meta.url), 'utf8')) as Pin;
const bytes = readFileSync(new URL('../vendor/glyph.js', import.meta.url));
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (pin.file !== 'vendor/glyph.js' || pin.bytes !== bytes.length || pin.sha256 !== sha256) {
  console.error(`vendor/glyph.js checksum mismatch: ${sha256} (${bytes.length} bytes), pin ${pin.sha256} (${pin.bytes} bytes)`);
  process.exit(1);
}
console.log(`vendor/glyph.js ${sha256}`);
