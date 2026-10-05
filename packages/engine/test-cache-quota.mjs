/**
 * Tests for analyze()'s cache/quota wiring: platform/videoId form fields,
 * X-Install-Id header, X-Cache passthrough, and the 429 quota error flag.
 * Run: node test-cache-quota.mjs
 */

import { analyze } from './engine.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`ok   - ${name}`);
  else { failures++; console.error(`FAIL - ${name}`); }
}

const blobs = [new Blob(['fake'], { type: 'image/webp' })];
const okBody = { answers: { slop_category: { type: 'choice', choice: 'organic', probabilities: { organic: 0.99 }, confidence: 0.9 } }, usage: { input_tokens: 10 }, model: 'clef-flash', clefMs: 1 };

// 1. platform/videoId/installId all land on the wire
{
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify(okBody), { status: 200 });
  };
  const r = await analyze(blobs, { platform: 'tiktok', videoId: 'https://www.tiktok.com/@user/video/123', installId: '11111111-2222-3333-4444-555555555555' });
  check('platform form field sent', seen.init.body.get('platform') === 'tiktok');
  check('videoId form field sent', seen.init.body.get('videoId') === 'https://www.tiktok.com/@user/video/123');
  check('frames still sent', seen.init.body.getAll('frames').length === 1);
  check('X-Install-Id header sent', seen.init.headers['X-Install-Id'] === '11111111-2222-3333-4444-555555555555');
  check('state/questions still sent', seen.init.body.get('state') && seen.init.body.get('questions'));
  check('200 without X-Cache -> cache null', r.cache === null);
}

// 2. token-only call: no install header, no cache fields (backward compat)
{
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { init };
    return new Response(JSON.stringify(okBody), { status: 200 });
  };
  await analyze(blobs, { token: 'sekret' });
  check('no platform/videoId fields when not provided', seen.init.body.get('platform') === null && seen.init.body.get('videoId') === null);
  check('X-Slop-Token sent alone', seen.init.headers['X-Slop-Token'] === 'sekret' && seen.init.headers['X-Install-Id'] === undefined);
}

// 3. no token, no installId -> no custom headers
{
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { init };
    return new Response(JSON.stringify(okBody), { status: 200 });
  };
  await analyze(blobs, {});
  check('headers undefined without token/installId', seen.init.headers === undefined);
}

// 4. X-Cache header passthrough on hit
{
  globalThis.fetch = async () =>
    new Response(JSON.stringify(okBody), { status: 200, headers: { 'X-Cache': 'hit' } });
  const r = await analyze(blobs, {});
  check('X-Cache: hit -> r.cache === "hit"', r.cache === 'hit');
}

// 5. 429 quota -> Error with .quota === true, message, no retry
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: 'daily quota exceeded', quota: true }), { status: 429 });
  };
  let err = null;
  try { await analyze(blobs, {}); } catch (e) { err = e; }
  check('429 -> throws', err !== null);
  check('err.quota === true', err?.quota === true);
  check('429 message surfaced', (err?.message ?? '').includes('daily quota exceeded'));
  check('429 not retried (1 attempt)', calls === 1);
}

// 6. non-quota 4xx keeps .quota falsy
{
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'No frames provided' }), { status: 400 });
  let err = null;
  try { await analyze(blobs, {}); } catch (e) { err = e; }
  check('400 -> throws without quota flag', err !== null && !err.quota);
}

console.log(failures === 0 ? '\nall tests passed' : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
