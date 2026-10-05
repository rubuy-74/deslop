/**
 * Demo page wiring: gallery sidebar, hold-then-warn-or-play flow,
 * and eval mode (runs the whole labeled gallery, reports expected vs actual).
 *
 * Served from the repo root (python3 -m http.server), so gallery/videos
 * live one level up:  /web/index.html -> ../gallery.json, ../videos/<file>
 */

import { analyzeVideo } from '../engine/engine.js';
import { CATEGORY_LABELS, CLEF_CONFIG, EXTRACTION, ANALYZE } from '../engine/config.js';

const $ = (sel) => document.querySelector(sel);
const player = $('#player');
const overlay = $('#overlay');
const statusEl = $('#status');

const params = new URLSearchParams(location.search);
const evalMode = params.get('eval') === '1';
const modelOverride = params.get('model');

let gallery = [];
let currentIndex = -1;
let lastDecision = null;

/* ---------------- helpers ---------------- */

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', isErr);
}

async function loadGallery() {
  try {
    const res = await fetch('../../gallery.json');
    gallery = await res.json();
  } catch {
    gallery = [];
  }
  renderGallery();
  if (gallery.length === 0) {
    setStatus('gallery.json is empty — add labeled videos to videos/ first', true);
  }
}

function renderGallery() {
  const list = $('#gallery');
  list.innerHTML = '';
  gallery.forEach((entry, i) => {
    const btn = document.createElement('button');
    const tag = typeof entry.expectFlag !== 'boolean'
      ? 'unlabeled'
      : entry.expectFlag
        ? (entry.expectCategory ?? 'slop')
        : 'organic';
    btn.innerHTML = `<span class="tag">${tag}</span>${entry.file}`;
    btn.classList.toggle('active', i === currentIndex);
    btn.addEventListener('click', () => selectVideo(i));
    list.appendChild(btn);
  });
}

function showOverlay(decision) {
  const pct = (decision.slopProb * 100).toFixed(0);
  const label = CATEGORY_LABELS[decision.reason] ?? decision.reason ?? 'unknown';
  const auth = decision.authenticity !== null ? `, authenticity ${decision.authenticity.toFixed(1)}/3` : '';
  $('#overlayWhy').textContent = `${label} — ${pct}% confident${auth}`;
  overlay.classList.add('show');
}

function hideOverlay() {
  overlay.classList.remove('show');
}

/* ---------------- interactive flow: hold, then warn-or-play ---------------- */

async function selectVideo(index) {
  currentIndex = index;
  renderGallery();
  hideOverlay();
  lastDecision = null;

  const entry = gallery[index];
  player.pause();
  player.src = `../../videos/${entry.file}`;
  player.currentTime = 0;

  setStatus('analyzing…');
  const decision = await analyzeVideo(player, { model: modelOverride ?? undefined });
  lastDecision = decision;

  if (decision.error) {
    // fail-open already happened in the engine; surface it and play.
    setStatus(`analysis failed open: ${decision.error}`, true);
    safePlay();
    return;
  }

  const ms = decision.timings;
  const timingStr = `extract ${ms.extractMs ?? '?'}ms · clef ${ms.clefMs ?? '?'}ms · ${(decision.payloadBytes / 1024).toFixed(0)}KB`;

  if (decision.flag) {
    setStatus(`flagged (${(decision.slopProb * 100).toFixed(0)}%) · ${timingStr}`);
    showOverlay(decision); // video stays held at frame 0 behind the scrim
  } else {
    setStatus(`passed (${(decision.slopProb * 100).toFixed(0)}% slop) · ${timingStr}`);
    safePlay();
  }
}

function safePlay() {
  player.play().catch(() => setStatus('playback blocked — press play manually', true));
}

$('#resumeBtn').addEventListener('click', () => {
  hideOverlay();
  safePlay();
});
$('#skipBtn').addEventListener('click', () => {
  hideOverlay();
  if (currentIndex + 1 < gallery.length) selectVideo(currentIndex + 1);
});

/* ---------------- eval mode ---------------- */

function evalOne(entry, video, model) {
  return new Promise((resolve) => {
    const onError = () => resolve({ entry, error: 'video load error' });
    video.addEventListener('error', onError, { once: true });
    video.addEventListener(
      'loadedmetadata',
      async () => {
        video.removeEventListener('error', onError);
        const t0 = performance.now();
        const decision = await analyzeVideo(video, {
          model: model ?? undefined,
          timeoutMs: ANALYZE.evalFetchTimeoutMs, // eval: let slow calls finish
        });
        resolve({ entry, decision, totalMs: Math.round(performance.now() - t0) });
      },
      { once: true }
    );
    video.src = `../../videos/${entry.file}`;
  });
}

async function runEval(model) {
  setStatus(`eval running${model ? ` (${model})` : ''}…`);
  hideOverlay();
  player.pause();
  player.removeAttribute('src');
  player.load();

  // Hidden video element so eval never touches the visible stage.
  const evalVideo = document.createElement('video');
  evalVideo.muted = true;
  evalVideo.preload = 'auto';

  const results = [];
  for (const entry of gallery) {
    setStatus(`eval: ${entry.file}`);
    results.push(await evalOne(entry, evalVideo, model));
  }
  const report = buildReport(results, model);
  renderEval(report);
  saveReport(report);
}

/**
 * Builds the persisted eval report: config snapshot (so every file is
 * self-describing), summary tallies, and per-video raw results.
 */
function buildReport(results, model) {
  const rows = results.map((r) => {
    const base = {
      file: r.entry.file,
      expectFlag: typeof r.entry.expectFlag === 'boolean' ? r.entry.expectFlag : null,
      expectCategory: r.entry.expectCategory ?? null,
    };
    if (r.error || r.decision?.error) {
      return { ...base, error: r.error ?? r.decision.error };
    }
    return { ...base, ...r.decision, totalMs: r.totalMs };
  });

  const labeled = rows.filter((r) => r.expectFlag !== null && !r.error);
  const unlabeled = rows.filter((r) => r.expectFlag === null && !r.error);
  const avg = (vals) => {
    const nums = vals.filter((v) => typeof v === 'number');
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  };

  return {
    timestamp: new Date().toISOString(),
    model: model ?? CLEF_CONFIG.model,
    threshold: CLEF_CONFIG.threshold,
    config: {
      state: CLEF_CONFIG.state,
      questions: CLEF_CONFIG.questions,
      extraction: EXTRACTION,
    },
    summary: {
      total: rows.length,
      labeled: labeled.length,
      correct: labeled.filter((r) => r.flag === r.expectFlag).length,
      unlabeled: unlabeled.length,
      errors: rows.filter((r) => r.error).length,
      disagreements: rows.filter((r) => r.disagreement).length,
      avgExtractMs: avg(rows.map((r) => r.timings?.extractMs)),
      avgClefMs: avg(rows.map((r) => r.timings?.clefMs)),
      avgTotalMs: avg(rows.map((r) => r.totalMs)),
      avgTokens: avg(rows.map((r) => r.usage?.input_tokens)),
    },
    results: rows,
  };
}

/** Persists the report via the dev server; falls back to a browser download. */
async function saveReport(report) {
  try {
    const res = await fetch('/api/eval-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { saved } = await res.json();
    setStatus(`eval done (${report.model}) — saved ${saved}`);
  } catch {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${report.timestamp.replace(/[:.]/g, '-')}_${report.model}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`eval done (${report.model}) — save endpoint unavailable, downloaded JSON instead`, true);
  }
}

function renderEval(report) {
  const s = report.summary;
  const esc = (v) => String(v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const cell = (v) => `<td>${esc(v ?? '')}</td>`;

  const rowHtml = report.results
    .map((r) => {
      if (r.error) {
        return `<tr class="fail">${cell(r.file)}${cell(r.expectFlag ?? 'unlabeled')}${cell('error')}${cell('')}${cell(r.error)}${cell('')}${cell('')}${cell('')}${cell('')}${cell('')}${cell('')}</tr>`;
      }
      const labeled = r.expectFlag !== null;
      const pass = labeled ? r.flag === r.expectFlag : null;
      return `<tr class="${pass === null ? 'unlabeled' : pass ? 'pass' : 'fail'}">
        ${cell(r.file)}${cell(labeled ? r.expectFlag : 'unlabeled')}${cell(r.flag)}
        ${cell(r.slopProb)}${cell(r.categoryChoice)}${cell(r.crossCheck?.toFixed(2))}
        ${cell(r.disagreement ? 'YES' : '')}${cell(r.authenticity?.toFixed(2))}
        ${cell(r.timings?.extractMs)}${cell(r.timings?.clefMs)}${cell(r.totalMs)}
      </tr>`;
    })
    .join('');

  $('#evalResults').innerHTML = `
    <h2>Eval results — model: ${esc(report.model)} · threshold ${report.threshold}</h2>
    <p class="mono">
      ${s.correct}/${s.labeled} correct${s.unlabeled ? ` · ${s.unlabeled} unlabeled (excluded)` : ''}${s.errors ? ` · ${s.errors} errors` : ''} · ${s.disagreements} cross-check disagreements ·
      avg extract ${s.avgExtractMs}ms · avg clef ${s.avgClefMs}ms · avg total ${s.avgTotalMs}ms · avg tokens ${s.avgTokens}
    </p>
    <table>
      <thead><tr>
        <th>file</th><th>expected</th><th>actual</th><th>slop%</th><th>category</th>
        <th>noul</th><th>dis</th><th>auth</th><th>extr ms</th><th>clef ms</th><th>total ms</th>
      </tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>`;
}

$('#evalBtn').addEventListener('click', () => runEval(null));
$('#evalClefBtn').addEventListener('click', () => runEval('clef'));

/* ---------------- boot ---------------- */

await loadGallery();
if (evalMode && gallery.length) {
  runEval(modelOverride);
} else if (gallery.length) {
  selectVideo(0);
}
