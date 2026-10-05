/**
 * Rasterizes icons/icon.svg (the warning-sign mark) into the PNG sizes the
 * manifest and the Chrome Web Store require (16/32/48/128). Reuses the sharp
 * binary that ships with wrangler under packages/worker/node_modules — no
 * new dependencies for this package.
 *
 * Run: npm run icons   (from packages/extension)
 */

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('../../worker/node_modules/sharp');

const here = dirname(fileURLToPath(import.meta.url));
const svg = await readFile(join(here, '../icons/icon.svg'));

for (const size of [16, 32, 48, 128]) {
  const out = join(here, '../icons', `icon-${size}.png`);
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out);
  console.log(`wrote ${out}`);
}
