/**
 * Builds the Chrome Web Store zip: stages a store-ready copy of the
 * extension into dist/ and zips it with manifest.json at the archive
 * root (a store zip must not contain dev files or gitignored local
 * noise beyond what's explicitly staged).
 *
 * Baked-token decision: the store build MUST include config.local.json
 * with a real shared secret — a tokenless build would 401 against the
 * deployed worker. The token is a casual-abuse filter by design; the
 * real backstops are the per-install daily quota, the shared verdict
 * cache, and the account's Cloudflare rate-limiting rule.
 *
 * Run: npm run zip   (from packages/extension)
 */

import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '..');
const dist = join(ext, 'dist');

const manifest = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8'));
const version = manifest.version;

// Guard: refuse a tokenless store build.
let token = '';
try {
  const cfg = JSON.parse(await readFile(join(ext, 'config.local.json'), 'utf8'));
  token = typeof cfg.token === 'string' ? cfg.token.trim() : '';
} catch {
  // missing or invalid — handled below
}
if (!token || token === 'PASTE_TOKEN_HERE') {
  console.error('store build requires a real token in packages/extension/config.local.json');
  console.error('  (baked-token decision: a tokenless build 401s against the deployed worker)');
  console.error('  copy config.local.example.json -> config.local.json and paste the shared secret');
  process.exit(1);
}

const stage = join(dist, `slop-rotting-${version}`);
await rm(dist, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

// 1:1 files at the zip root.
for (const f of [
  'manifest.json',
  'background.js',
  'content.js',
  'overlay.js',
  'debug-panel.js',
  'options.html',
  'options.js',
  'config.local.json',
]) {
  await cp(join(ext, f), join(stage, f));
}

// Whole directories.
await cp(join(ext, 'adapters'), join(stage, 'adapters'), { recursive: true });
// Icons: only the rasterized sizes the manifest references — not the SVG source.
await mkdir(join(stage, 'icons'), { recursive: true });
for (const f of ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png']) {
  await cp(join(ext, 'icons', f), join(stage, 'icons', f));
}

// Vendor is staged FRESH from the engine package — never trust a stale
// vendor/ dir (the build script copies these; zip.mjs repeats it so the
// store artifact can never ship outdated engine code).
await mkdir(join(stage, 'vendor'), { recursive: true });
await cp(join(ext, '../engine/engine.js'), join(stage, 'vendor/engine.js'));
await cp(join(ext, '../engine/config.js'), join(stage, 'vendor/config.js'));

const zipPath = join(dist, `slop-rotting-${version}.zip`);
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: stage });
console.log(`staged ${stage}`);
console.log(`wrote ${zipPath}`);
