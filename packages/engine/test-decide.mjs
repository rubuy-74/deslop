/**
 * Smoke tests for the engine's pure functions (decide, computeTimestamps).
 * Run: node test-decide.mjs
 */

import { decide, computeTimestamps } from './engine.js';
import { CLEF_CONFIG } from './config.js';

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`ok   - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}

function answers({ probs, choice, noul, score }) {
  return {
    slop_category: { type: 'choice', choice, probabilities: probs, confidence: 0.9 },
    is_slop: { type: 'noul', noul },
    visual_authenticity: { type: 'score', score, legend: {}, probabilities: {}, confidence: 0.9 },
  };
}

/* --- decide: flagging --- */
{
  const a = answers({
    probs: { organic: 0.02, absurdist_ai: 0.91, synthetic_parody: 0.05, static_ai_slideshow: 0.01, other_ai: 0.01 },
    choice: 'absurdist_ai', noul: 0.93, score: 0.4,
  });
  const d = decide(a);
  check('clear slop flags', d.flag === true);
  check('slopProb = 1 - organic', d.slopProb === 0.98);
  check('reason is top non-organic', d.reason === 'absurdist_ai');
  check('no disagreement when noul agrees', d.disagreement === false);
  check('authenticity passed through', d.authenticity === 0.4);
}

{
  const a = answers({
    probs: { organic: 0.9, absurdist_ai: 0.05, synthetic_parody: 0.02, static_ai_slideshow: 0.02, other_ai: 0.01 },
    choice: 'organic', noul: 0.08, score: 2.9,
  });
  const d = decide(a);
  check('clear organic passes', d.flag === false);
  check('reason null when not flagged', d.reason === null);
  check('no disagreement on organic', d.disagreement === false);
}

{
  // Threshold boundary: organic 0.20 -> slopProb 0.80 -> flag at >= 0.80
  const a = answers({
    probs: { organic: 0.2, absurdist_ai: 0.6, synthetic_parody: 0.1, static_ai_slideshow: 0.05, other_ai: 0.05 },
    choice: 'absurdist_ai', noul: 0.7, score: 1.1,
  });
  check('boundary (1-organic=0.80) flags at threshold', decide(a).flag === true);
}

{
  // Just under threshold
  const a = answers({
    probs: { organic: 0.21, absurdist_ai: 0.6, synthetic_parody: 0.09, static_ai_slideshow: 0.05, other_ai: 0.05 },
    choice: 'absurdist_ai', noul: 0.7, score: 1.1,
  });
  check('just under threshold passes', decide(a).flag === false);
}

{
  // Taxonomy-hole case: noul says slop, choice says organic -> disagreement logged, choice wins
  const a = answers({
    probs: { organic: 0.9, absurdist_ai: 0.04, synthetic_parody: 0.03, static_ai_slideshow: 0.02, other_ai: 0.01 },
    choice: 'organic', noul: 0.85, score: 1.4,
  });
  const d = decide(a);
  check('choice-primary: organic wins despite high noul', d.flag === false);
  check('disagreement detected (taxonomy-hole signal)', d.disagreement === true);
}

{
  // other_ai catch-all still flags (only organic suppresses)
  const a = answers({
    probs: { organic: 0.05, absurdist_ai: 0.1, synthetic_parody: 0.05, static_ai_slideshow: 0.05, other_ai: 0.75 },
    choice: 'other_ai', noul: 0.88, score: 0.6,
  });
  const d = decide(a);
  check('other_ai catch-all flags', d.flag === true);
  check('reason can be other_ai', d.reason === 'other_ai');
}

{
  // Robustness: malformed answers fail OPEN (never flag, error reported)
  const d = decide({});
  check('empty answers never flags', d.flag === false);
  check('empty answers report error', typeof d.error === 'string');
  const d2 = decide(undefined);
  check('undefined answers never throws, never flags', d2.flag === false && typeof d2.error === 'string');
  const d3 = decide({ slop_category: { type: 'choice', choice: 'organic', probabilities: {}, confidence: 0 } });
  check('missing organic key never flags', d3.flag === false && typeof d3.error === 'string');
}

{
  // Custom threshold respected
  const a = answers({
    probs: { organic: 0.5, absurdist_ai: 0.3, synthetic_parody: 0.1, static_ai_slideshow: 0.05, other_ai: 0.05 },
    choice: 'organic', noul: 0.4, score: 2.0,
  });
  const cfg = { ...CLEF_CONFIG, threshold: 0.4 };
  check('custom threshold applies', decide(a, cfg).flag === true);
}

/* --- computeTimestamps --- */
{
  const ts = computeTimestamps(10);
  check('10s video -> 2s window, 3 frames', ts.length === 3 && ts[2] <= 2.0);
  check('fractions applied', ts[0] === 0.3 && ts[2] === 1.8);
}
{
  const ts = computeTimestamps(1.2);
  check('short video scales (no duplicates)', new Set(ts).size === ts.length && ts[2] <= 1.2);
  check('short video last ts = 0.9*1.2', ts[2] === +(0.9 * 1.2).toFixed(3));
}
{
  const ts = computeTimestamps(0.5);
  check('very short video still 3 unique stamps', new Set(ts).size === 3);
}

console.log(failures === 0 ? '\nall tests passed' : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
