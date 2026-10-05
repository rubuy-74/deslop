/**
 * Tests for analyze()'s retry semantics: aborts get exactly one retry,
 * deterministic HTTP errors fail immediately without retrying.
 * Run: node test-retry.mjs
 */

import { analyze } from './engine.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`ok   - ${name}`);
  else { failures++; console.error(`FAIL - ${name}`); }
}

const blobs = [new Blob(['fake'], { type: 'image/webp' })];
const okBody = { answers: { slop_category: { type: 'choice', choice: 'organic', probabilities: { organic: 0.99 }, confidence: 0.9 } }, usage: { input_tokens: 10 }, model: 'clef-flash', clefMs: 1 };

// 1. First attempt aborts, second succeeds -> returns body, 2 attempts
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    }
    return new Response(JSON.stringify(okBody), { status: 200 });
  };
  const r = await analyze(blobs, {});
  check('abort then success -> succeeds', r.answers.slop_category.choice === 'organic');
  check('exactly 2 fetch attempts', calls === 2);
}

// 2. Both attempts abort -> throws, 2 attempts
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    throw err;
  };
  let threw = false;
  try { await analyze(blobs, {}); } catch { threw = true; }
  check('abort twice -> throws', threw);
  check('exactly 2 fetch attempts (no third)', calls === 2);
}

// 3. HTTP 502 (deterministic AiError) -> throws immediately, 1 attempt
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: 'Clef call failed: AiError: 5021' }), { status: 502 });
  };
  let msg = '';
  try { await analyze(blobs, {}); } catch (e) { msg = e.message; }
  check('502 -> throws with worker error message', msg.includes('5021'));
  check('no retry on deterministic error (1 attempt)', calls === 1);
}

// 4. Non-abort network error -> no retry
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError('fetch failed');
  };
  let threw = false;
  try { await analyze(blobs, {}); } catch { threw = true; }
  check('network TypeError -> throws', threw);
  check('no retry on non-abort error (1 attempt)', calls === 1);
}

// 5. 200 with malformed body (missing answers) -> throws, 1 attempt
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ unexpected: true }), { status: 200 });
  };
  let msg = '';
  try { await analyze(blobs, {}); } catch (e) { msg = e.message; }
  check('malformed 200 -> throws', msg.includes('missing answers'));
  check('no retry on malformed body (1 attempt)', calls === 1);
}

console.log(failures === 0 ? '\nall tests passed' : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
