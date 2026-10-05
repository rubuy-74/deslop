/**
 * Platform-agnostic anti-slop engine.
 *
 *   extractFrames(video) -> Blob[]   (seek + letterbox + encode)
 *   analyze(blobs)       -> Clef answers (via Worker)
 *   decide(answers)      -> { flag, reason, ... }
 *   analyzeVideo(video)  -> orchestrates all three, fail-open on any error
 *
 * This module must stay DOM-platform-agnostic: it operates on any
 * HTMLVideoElement and never assumes the video is paused — Part 2
 * (platform integration) will call it on autoplaying feed videos.
 */

import { WORKER_URL, EXTRACTION, ANALYZE, CLEF_CONFIG } from './config.js';

/* ---------------- frame extraction ---------------- */

/** Pure: sample timestamps for a video of the given duration. */
export function computeTimestamps(durationS, cfg = EXTRACTION) {
  const window = Math.min(durationS, cfg.windowCapS);
  return cfg.fractions.map((f) => +(f * window).toFixed(3));
}

function waitForMetadata(video, timeoutMs) {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup() || reject(new Error('metadata timeout')), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onLoaded);
    };
    const onLoaded = () => cleanup() || resolve();
    video.addEventListener('loadedmetadata', onLoaded);
  });
}

function seekVideo(video, targetTime, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup() || reject(new Error(`seek timeout @${targetTime}`)), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
    };
    const onSeeked = () => cleanup() || resolve();
    video.addEventListener('seeked', onSeeked);
    video.currentTime = targetTime;
  });
}

function toBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      mimeType,
      quality
    );
  });
}

/** Letterbox-draw the current video frame into the fixed-size canvas. */
function drawLetterboxed(ctx, video, cfg) {
  const { canvasWidth: cw, canvasHeight: ch } = cfg;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

/**
 * Encodes one canvas frame, stepping down the quality ladder until it fits
 * the byte budget. Falls back to JPEG if WebP encode is unsupported, and
 * applies the ladder to whichever type the browser produced.
 */
async function encodeFrame(canvas, cfg) {
  let blob = await toBlob(canvas, cfg.mimeType, cfg.quality);
  if (blob.type !== cfg.mimeType) {
    // e.g. Safari lacks WebP encode -> retry as JPEG
    blob = await toBlob(canvas, cfg.fallbackMimeType, cfg.quality);
  }
  const type = blob.type;
  // Initial encode was cfg.quality; dedupe the ladder against it so we never
  // re-encode at a quality already tried.
  const ladder = [...new Set(cfg.qualityLadder)].filter((q) => q < cfg.quality);
  for (const q of ladder) {
    if (blob.size <= cfg.maxFrameBytes) break;
    blob = await toBlob(canvas, type, q);
  }
  return blob;
}

/**
 * Extracts frames from a video element.
 * @returns {Promise<{blobs: Blob[], extractMs: number}>}
 */
export async function extractFrames(video, cfg = EXTRACTION) {
  const started = performance.now();
  await waitForMetadata(video, cfg.seekTimeoutMs);
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error(`unusable duration: ${video.duration}`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = cfg.canvasWidth;
  canvas.height = cfg.canvasHeight;
  const ctx = canvas.getContext('2d');

  const originalTime = video.currentTime;
  const blobs = [];
  try {
    for (const t of computeTimestamps(video.duration, cfg)) {
      await seekVideo(video, Math.min(t, video.duration), cfg.seekTimeoutMs);
      drawLetterboxed(ctx, video, cfg);
      blobs.push(await encodeFrame(canvas, cfg));
    }
  } finally {
    video.currentTime = originalTime;
  }
  return { blobs, extractMs: performance.now() - started };
}

/**
 * Captures frames from a PLAYING video without seeking — the live-feed
 * primitive: on real platforms the video streams progressively and seeking
 * would both disrupt the user's position and race the buffer. Instead we
 * grab whatever is on screen at `count` moments spaced `intervalMs` apart.
 * @returns {Promise<{blobs: Blob[], captureMs: number}>}
 */
export async function capturePassiveFrames(video, { count = 3, intervalMs = 600 } = {}, cfg = EXTRACTION) {
  if (video.readyState < 2) throw new Error('video not ready for passive capture');
  const started = performance.now();
  const canvas = document.createElement('canvas');
  canvas.width = cfg.canvasWidth;
  canvas.height = cfg.canvasHeight;
  const ctx = canvas.getContext('2d');

  const blobs = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, intervalMs));
    drawLetterboxed(ctx, video, cfg);
    blobs.push(await encodeFrame(canvas, cfg));
  }
  return { blobs, captureMs: performance.now() - started };
}

/* ---------------- worker / clef ---------------- */

/**
 * Sends frames to the Worker, which forwards them to Clef.
 * Aborts (our own timeout, e.g. transient Workers AI queueing) get exactly
 * one retry with a fresh timeout; deterministic errors (4xx/5xx, AiError)
 * fail immediately — retrying those just doubles the wait for the same error.
 *
 * Connection is injectable: testbed uses localhost defaults, the extension
 * injects the deployed worker URL + shared-secret token.
 *
 * Cache/quota wiring (optional): `platform` + `videoId` let the Worker serve
 * the shared verdict cache (only canonical http(s) video URLs are cacheable
 * — the Worker ignores blob: keys), and `installId` is sent as X-Install-Id
 * so the Worker can count per-install daily quota. A 429 quota rejection
 * throws an Error with `.quota === true` (deterministic — never retried).
 *
 * @returns {Promise<{answers: object, usage: object, clefMs: number, model: string, cache: string|null}>}
 */
export async function analyze(
	blobs,
	{ model, timeoutMs, workerUrl, token, installId, platform, videoId } = {},
	cfg = CLEF_CONFIG
) {
	const url = workerUrl ?? WORKER_URL;
	const makeForm = () => {
		const form = new FormData();
		for (const blob of blobs) form.append('frames', blob, 'frame.' + (blob.type === 'image/webp' ? 'webp' : 'jpg'));
		form.append('state', cfg.state);
		form.append('questions', JSON.stringify(cfg.questions));
		form.append('model', model ?? cfg.model);
		if (platform) form.append('platform', platform);
		if (videoId) form.append('videoId', videoId);
		return form;
	};
	const headers = {};
	if (token) headers['X-Slop-Token'] = token;
	if (installId) headers['X-Install-Id'] = installId;

	let lastErr;
	for (let attempt = 0; attempt < 2; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs ?? ANALYZE.fetchTimeoutMs);
		try {
			const res = await fetch(url, {
				method: 'POST',
				body: makeForm(),
				signal: controller.signal,
				headers: Object.keys(headers).length ? headers : undefined,
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				const err = new Error(body.error ?? `worker HTTP ${res.status}`);
				err.quota = body.quota === true; // 429 daily-quota rejection
				throw err;
			}
			if (!body.answers) throw new Error('worker response missing answers');
			return { ...body, cache: res.headers.get('x-cache') };
    } catch (err) {
      lastErr = err;
      const aborted = err.name === 'AbortError' || /aborted/i.test(err.message ?? '');
      if (!aborted || attempt === 1) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ---------------- decision ---------------- */

/** Pure: turn Clef answers into a flag decision. Never throws, fail-open:
 *  malformed answers produce { flag: false, error } rather than a flag. */
export function decide(answers, cfg = CLEF_CONFIG) {
  const catAnswer = answers?.slop_category;
  const probs = catAnswer?.probabilities;
  if (!probs || typeof probs.organic !== 'number') {
    return {
      flag: false,
      reason: null,
      slopProb: null,
      crossCheck: answers?.is_slop?.noul ?? null,
      disagreement: false,
      authenticity: answers?.visual_authenticity?.score ?? null,
      categoryChoice: catAnswer?.choice ?? null,
      error: 'malformed answers: missing slop_category.probabilities.organic',
    };
  }
  const pOrganic = probs.organic;
  const slopProb = 1 - pOrganic;
  const flag = slopProb >= cfg.threshold;

  // Reason: highest-probability non-organic category.
  const reason = Object.entries(probs)
    .filter(([k]) => k !== 'organic')
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? catAnswer?.choice ?? null;

  // Second opinion: noul probability; disagreement is a taxonomy-hole signal.
  const crossCheck = answers?.is_slop?.noul ?? null;
  const disagreement = crossCheck !== null && (crossCheck >= 0.5) !== flag;

  return {
    flag,
    reason: flag ? reason : null,
    slopProb: +slopProb.toFixed(4),
    crossCheck,
    disagreement,
    authenticity: answers?.visual_authenticity?.score ?? null,
    categoryChoice: catAnswer?.choice ?? null,
  };
}

/* ---------------- orchestration ---------------- */

/**
 * Full pipeline for one video element. FAIL-OPEN: any error returns
 * { flag: false, error } so a classifier outage never blocks playback.
 */
export async function analyzeVideo(video, opts = {}) {
  const timings = {};
  let blobs;
  try {
    const extraction = await extractFrames(video, opts.extractionCfg);
    blobs = extraction.blobs;
    timings.extractMs = Math.round(extraction.extractMs);
  } catch (err) {
    return { flag: false, error: `extraction: ${err.message}`, timings };
  }

  const payloadBytes = blobs.reduce((n, b) => n + b.size, 0);
  try {
    const response = await analyze(blobs, opts, opts.clefCfg);
    timings.clefMs = response.clefMs ?? null;
    const decision = decide(response.answers, opts.clefCfg);
    return {
      ...decision,
      timings,
      usage: response.usage ?? null,
      model: response.model ?? null,
      payloadBytes,
    };
  } catch (err) {
    // payloadBytes included so context-limit failures are diagnosable from eval JSONs
    return { flag: false, error: `analyze: ${err.message}`, timings, payloadBytes };
  }
}
