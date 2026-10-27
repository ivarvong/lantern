// Rebuild vendor/glyph.js (loadFont + run) from a checkout of the glyph repo.
// The bundle stays JavaScript; vendor/glyph.d.ts types it by hand.
// After a rebuild, put the printed sha256 and byte length into vendor/glyph.pin.json.
//   node tools/vendor-glyph.ts ../glyph
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { resolve } from 'node:path';
const repo = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('usage: node tools/vendor-glyph.ts <path to glyph repo>'); process.exit(2); }
const outfile = new URL('../vendor/glyph.js', import.meta.url).pathname;
await build({
  stdin: { contents: `export { loadFont } from '${repo}/index.js';\nexport { run } from '${repo}/render/src/compose.js';`, resolveDir: repo },
  bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'warning',
});
const bytes = readFileSync(outfile);
const sha256 = createHash('sha256').update(bytes).digest('hex');
console.log(`vendor/glyph.js rebuilt: ${bytes.length} bytes, sha256 ${sha256}`);
console.log('Update vendor/glyph.pin.json to that checksum before committing.');
