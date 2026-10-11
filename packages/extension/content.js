/**
 * Content script: watches the Shorts feed for newly active videos, captures
 * frames passively from live playback (no seeking — the video streams
 * progressively and the user's position is sacred), and asks the background
 * worker proxy for a decision. On a flag: pause + overlay, fail open always.
 */

(async () => {
  const url = (p) => chrome.runtime.getURL(p);
  const { startOnce } = await import(url('content-bootstrap.js'));

  await startOnce(globalThis, async () => {
  const { capturePassiveFrames } = await import(url('vendor/engine.js'));
  const { CLEF_CONFIG } = await import(url('vendor/config.js'));
  const { YoutubeShortsAdapter } = await import(url('adapters/youtube-shorts.js'));
  const { TiktokAdapter } = await import(url('adapters/tiktok.js'));
  const { InstagramReelsAdapter } = await import(url('adapters/instagram-reels.js'));
  const { showOverlay } = await import(url('overlay.js'));
  const { initDebugPanel } = await import(url('debug-panel.js'));
  const { createDiagnostics } = await import(url('diagnostics.js'));

  /** Platform adapters, tried in order per tick. */
  const ADAPTERS = [YoutubeShortsAdapter, TiktokAdapter, InstagramReelsAdapter];
  const adapterFor = (loc) => ADAPTERS.find((a) => a.matches(loc)) ?? null;

  /** key -> 'analyzing' | 'passed' | 'flagged' | 'resumed' */
  const seen = new Map();

  /** Most recent completed analysis — source of frames/decision for feedback. */
  let lastAnalysis = null;
  let diagnostics;
  let nextJobId = 0;
  let lastContextState = null;

  function sendFeedback(report) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'feedback timeout' }), 10000);
      chrome.runtime.sendMessage({ type: 'feedback', report }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, error: friendlyError(chrome.runtime.lastError?.message ?? 'no response') });
        } else {
          resolve(response);
        }
      });
    });
  }

  function buildReport({ adapter, key, reportedLabel, comment, decision, dataUrls, captureContext }) {
    return {
      timestamp: new Date().toISOString(),
      platform: adapter.name,
      videoUrl: location.href,
      videoKey: key,
      reportedLabel,
      userComment: comment,
      engineDecision: decision ?? null,
      captureContext,
      model: CLEF_CONFIG.model,
      threshold: CLEF_CONFIG.threshold,
      frames: dataUrls,
      config: { state: CLEF_CONFIG.state, questions: CLEF_CONFIG.questions },
    };
  }

  // False-negative path: video PASSED but the user says it's slop.
  // Fresh capture — the video is playing, and late-reveal slop is the case
  // this exists for (per eval findings).
  async function onReportSlop(comment) {
    const adapter = adapterFor(location);
    if (!adapter) return { ok: false, error: 'no adapter for this page' };
    const video = adapter.findActiveVideo();
    if (!video || video.readyState < 2) return { ok: false, error: 'no active video' };
    const key = adapter.videoKey(video);
    const { blobs } = await capturePassiveFrames(video, { count: 3, intervalMs: 400 });
    const dataUrls = await Promise.all(blobs.map(blobToDataUrl));
    const report = buildReport({
      adapter,
      key,
      reportedLabel: 'slop',
      comment,
      decision: lastAnalysis?.key === key ? lastAnalysis.decision : null,
      dataUrls,
      captureContext: 'fresh-on-report',
    });
    const res = await sendFeedback(report);
    panel.log({ key, verdict: res.ok ? 'pass' : 'err', extra: res.ok ? `feedback: slop → ${res.key}` : `feedback failed: ${res.error}` });
    return res;
  }

  // Debug/feedback panel: OFF by default — production users never see it.
  // Opt-in checkbox on the options page; takes effect on page reload.
  const { debugPanel: debugPanelEnabled } = await chrome.storage.sync.get({ debugPanel: false });
  const panel = debugPanelEnabled
    ? initDebugPanel({ onReportSlop, onExport: () => diagnostics?.export() })
    : { log() {}, setStatus() {}, setPlatform() {} };
  diagnostics = createDiagnostics({ enabled: debugPanelEnabled, onEvent: (event) => panel.log({ event }) });

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /** Dead after an extension reload: chrome.runtime.id disappears. */
  function contextAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  const friendlyError = (msg) =>
    /invalidated/i.test(msg ?? '') ? 'extension reloaded — refresh this tab' : msg;

  function sendForAnalysis(dataUrls, adapter, videoId, jobId) {
    const requestStarted = performance.now();
    diagnostics.record('request.start', { platform: adapter.name, jobId, requestCount: 1 });
    return new Promise((resolve) => {
      // A hung background must never wedge a video in 'analyzing' forever.
      const timer = setTimeout(() => {
        const requestMs = Math.round(performance.now() - requestStarted);
        diagnostics.record('request.complete', { platform: adapter.name, jobId, outcome: 'timeout', errorCode: 'timeout', requestMs, requestCount: 1 });
        resolve({ flag: false, error: 'background timeout (12s)', requestMs, requestCount: 1 });
      }, 12000);
      // platform + canonical videoId let the Worker serve the shared
      // verdict cache (canonicalUrl() is null in unsynced feed contexts —
      // blob keys then pass through inert, never cached, by design).
      chrome.runtime.sendMessage(
        {
          type: 'analyze',
          frames: dataUrls,
          platform: adapter.name,
          videoId: adapter.canonicalUrl?.() ?? videoId,
        },
        (response) => {
           clearTimeout(timer);
           diagnostics.record('request.complete', {
             outcome: chrome.runtime.lastError || !response ? 'error' : 'ok',
             platform: adapter.name,
             jobId,
             errorCode: chrome.runtime.lastError || !response ? 'worker unavailable' : undefined,
             requestMs: Math.round(performance.now() - requestStarted),
             requestCount: 1,
           });
          if (chrome.runtime.lastError || !response) {
            resolve({ flag: false, error: friendlyError(chrome.runtime.lastError?.message ?? 'no response') });
          } else {
             resolve({
               ...response.decision,
               cache: response.cache ?? null,
               requestMs: Math.round(performance.now() - requestStarted),
               requestCount: 1,
             });
          }
        }
      );
    });
  }

  async function processVideo(video, adapter) {
    const key = adapter.videoKey(video);
    if (!key || seen.has(key)) return;
    // Only analyze once the video is actually playing with data available —
    // otherwise return WITHOUT marking seen so the next tick retries.
    if (video.readyState < 2 || video.paused) return;
    const jobId = ++nextJobId;
    const started = performance.now();
    diagnostics.record('analysis.start', { platform: adapter.name, jobId });
    seen.set(key, 'analyzing');
    panel.log({ id: jobId, verdict: 'analyzing' });

    try {
      // 3 frames over ~1.2s of live playback; decision lands ~2-3s into the short.
      const t0 = performance.now();
      const captureStarted = performance.now();
      const { blobs } = await capturePassiveFrames(video, { count: 3, intervalMs: 600 });
      diagnostics.record('capture.complete', { platform: adapter.name, jobId, captureMs: Math.round(performance.now() - captureStarted) });
      const dataUrls = await Promise.all(blobs.map(blobToDataUrl));
      const decision = await sendForAnalysis(dataUrls, adapter, key, jobId);
      const ms = Math.round(performance.now() - t0);
      diagnostics.record('analysis.complete', {
        platform: adapter.name,
        jobId,
        totalMs: Math.round(performance.now() - started),
        outcome: decision.error ? 'error' : decision.flag ? 'flag' : 'pass',
        errorCode: decision.error ? diagnosticErrorCode(decision.error) : undefined,
        cache: decision.cache ?? 'none',
        requestMs: decision.requestMs,
        requestCount: decision.requestCount,
        reason: decision.reason ?? undefined,
        slopProb: decision.slopProb ?? undefined,
        authenticity: decision.authenticity ?? undefined,
        categoryChoice: decision.categoryChoice ?? undefined,
        categoryConfidence: decision.categoryConfidence ?? undefined,
      });
      if (!decision.error) lastAnalysis = { key, decision, dataUrls };

      if (decision.error) {
        console.warn('[slop] fail-open:', decision.error);
        if (decision.quota) panel.setStatus(false, 'daily quota exhausted — resumes tomorrow');
        else if (/unauthorized/i.test(decision.error)) panel.setStatus(false, 'unauthorized — set token');
        panel.log({ id: jobId, verdict: 'err', extra: decision.error });
        seen.set(key, 'passed');
        return;
      }
      // Shared-verdict-cache marker: the first viewer pays the Clef call,
      // everyone after gets it free (X-Cache: hit).
      const cacheTag = decision.cache === 'hit' ? ' cache=hit' : '';
      if (!decision.flag) {
        diagnostics.record('decision.apply', { platform: adapter.name, jobId, outcome: 'pass' });
        panel.log({ id: jobId, verdict: 'pass', extra: `slop=${decision.slopProb} ${ms}ms${cacheTag}` });
        seen.set(key, 'passed');
        return;
      }

      // Video may have advanced while we analyzed; only warn if still current.
      if (adapter.findActiveVideo() !== video || seen.get(key) === 'resumed') {
        diagnostics.record('decision.apply', { platform: adapter.name, jobId, outcome: 'stale' });
        seen.set(key, 'flagged'); // remember verdict if the user scrolls back
        return;
      }

      seen.set(key, 'flagged');
      diagnostics.record('decision.apply', { platform: adapter.name, jobId, outcome: 'flag' });
      panel.log({ id: jobId, verdict: 'flag', extra: `${decision.reason} slop=${decision.slopProb} ${ms}ms${cacheTag}` });
      diagnostics.record('overlay.show', { platform: adapter.name, jobId });
      video.pause();
      showOverlay(
        adapter.overlayHost(video),
        {
          onResume: () => {
            diagnostics.record('overlay.resume', { platform: adapter.name, jobId });
            seen.set(key, 'resumed');
            video.play().catch(() => {});
          },
          onSkip: () => {
            const advanced = adapter.next();
            diagnostics.record('overlay.skip', { platform: adapter.name, jobId, skipOutcome: advanced ? 'advanced' : 'resumed' });
            if (!advanced) video.play().catch(() => {}); // no next control: unstick
          },
          // False-positive path: flagged but the user says organic. Reuses the
          // exact frames Clef judged (video is paused — fresh capture would be
          // 3 copies of the same frame).
          onReport: async (comment) => {
            const report = buildReport({
              adapter,
              key,
              reportedLabel: 'organic',
              comment,
              decision,
              dataUrls,
              captureContext: 'analysis-cache',
            });
            const res = await sendFeedback(report);
            panel.log({ key, verdict: res.ok ? 'pass' : 'err', extra: res.ok ? `feedback: organic → ${res.key}` : `feedback failed: ${res.error}` });
            return res.ok;
          },
        },
        { strategy: adapter.overlayStrategy }
      );
    } catch (err) {
      console.warn('[slop] analysis failed open:', err);
      diagnostics.record('analysis.complete', { platform: adapter.name, jobId, totalMs: Math.round(performance.now() - started), outcome: 'error', errorCode: diagnosticErrorCode(err?.message) });
      panel.log({ id: jobId, verdict: 'err', extra: String(err?.message ?? err) });
      seen.set(key, 'passed');
    }
  }

  function diagnosticErrorCode(message) {
    const text = String(message ?? '').toLowerCase();
    if (text.includes('timeout') || text.includes('aborted')) return 'timeout';
    if (text.includes('quota')) return 'quota exhausted';
    if (text.includes('unauthorized') || text.includes('401')) return 'unauthorized';
    if (text.includes('malformed') || text.includes('missing answers')) return 'malformed response';
    return 'analysis failed';
  }

  let ticking = false;
  let halted = false;
  function halt(reason) {
    if (halted) return;
    halted = true;
    observer.disconnect();
    clearInterval(intervalId);
    panel.setStatus(false, reason);
  }

  function tick() {
    if (ticking || halted) return;
    ticking = true;
    try {
      if (!contextAlive()) {
        halt('ext reloaded — refresh this tab');
        return;
      }
      const adapter = adapterFor(location);
      panel.setPlatform(adapter?.name ?? null);
      if (!adapter) return;
      const supported = adapter.supportsContext(location);
      const contextReason = supported ? 'supported-feed' : contextReasonFor(adapter, location);
      const contextState = `${adapter.name}:${contextReason}`;
      if (contextState !== lastContextState) {
        lastContextState = contextState;
        diagnostics.record('context.check', {
          platform: adapter.name,
          contextOutcome: supported ? 'supported' : 'unsupported',
          contextReason,
        });
      }
      if (!supported) return;
      const video = adapter.findActiveVideo();
      if (video) processVideo(video, adapter);
    } finally {
      ticking = false;
    }
  }

  function contextReasonFor(adapter, loc) {
    if (adapter.name === 'tiktok') {
      if (/\/search(?:\/|$)/.test(loc.pathname)) return 'unsupported-search';
      if (/^\/@[^/]+(?:\/|$)/.test(loc.pathname)) return 'unsupported-profile-or-video';
      return 'unsupported-route';
    }
    if (adapter.name === 'instagram-reels') {
      if (/\/stories(?:\/|$)/.test(loc.pathname)) return 'unsupported-stories';
      if (/\/(?:p|explore|accounts|direct|embed)(?:\/|$)/.test(loc.pathname)) return 'unsupported-route';
      return 'unsupported-route';
    }
    return 'unsupported-route';
  }

  const observer = new MutationObserver(tick);
  observer.observe(document.body, { childList: true, subtree: true });
  const intervalId = setInterval(tick, 800); // SPA navigations don't always mutate promptly
  tick();
  });
})();
