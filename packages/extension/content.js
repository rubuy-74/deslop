/**
 * Content script: watches the Shorts feed for newly active videos, captures
 * frames passively from live playback (no seeking — the video streams
 * progressively and the user's position is sacred), and asks the background
 * worker proxy for a decision. On a flag: pause + overlay, fail open always.
 */

(async () => {
  const url = (p) => chrome.runtime.getURL(p);
  const { capturePassiveFrames } = await import(url('vendor/engine.js'));
  const { CATEGORY_LABELS, CLEF_CONFIG } = await import(url('vendor/config.js'));
  const { YoutubeShortsAdapter } = await import(url('adapters/youtube-shorts.js'));
  const { TiktokAdapter } = await import(url('adapters/tiktok.js'));
  const { InstagramReelsAdapter } = await import(url('adapters/instagram-reels.js'));
  const { showOverlay } = await import(url('overlay.js'));
  const { initDebugPanel } = await import(url('debug-panel.js'));

  /** Platform adapters, tried in order per tick. */
  const ADAPTERS = [YoutubeShortsAdapter, TiktokAdapter, InstagramReelsAdapter];
  const adapterFor = (loc) => ADAPTERS.find((a) => a.matches(loc)) ?? null;

  /** key -> 'analyzing' | 'passed' | 'flagged' | 'resumed' */
  const seen = new Map();

  /** Most recent completed analysis — source of frames/decision for feedback. */
  let lastAnalysis = null;

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

  const panel = initDebugPanel({
    // False-negative path: video PASSED but the user says it's slop.
    // Fresh capture — the video is playing, and late-reveal slop is the case
    // this exists for (per eval findings).
    onReportSlop: async (comment) => {
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
    },
  });

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

  function sendForAnalysis(dataUrls, adapter, videoId) {
    return new Promise((resolve) => {
      // A hung background must never wedge a video in 'analyzing' forever.
      const timer = setTimeout(() => resolve({ flag: false, error: 'background timeout (12s)' }), 12000);
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
          if (chrome.runtime.lastError || !response) {
            resolve({ flag: false, error: friendlyError(chrome.runtime.lastError?.message ?? 'no response') });
          } else {
            resolve({ ...response.decision, cache: response.cache ?? null });
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
    seen.set(key, 'analyzing');
    panel.log({ key, verdict: 'analyzing' });

    try {
      // 3 frames over ~1.2s of live playback; decision lands ~2-3s into the short.
      const t0 = performance.now();
      const { blobs } = await capturePassiveFrames(video, { count: 3, intervalMs: 600 });
      const dataUrls = await Promise.all(blobs.map(blobToDataUrl));
      const decision = await sendForAnalysis(dataUrls, adapter, key);
      const ms = Math.round(performance.now() - t0);
      if (!decision.error) lastAnalysis = { key, decision, dataUrls };

      if (decision.error) {
        console.warn('[slop] fail-open:', decision.error);
        if (decision.quota) panel.setStatus(false, 'daily quota exhausted — resumes tomorrow');
        else if (/unauthorized/i.test(decision.error)) panel.setStatus(false, 'unauthorized — set token');
        panel.log({ key, verdict: 'err', extra: decision.error });
        seen.set(key, 'passed');
        return;
      }
      // Shared-verdict-cache marker: the first viewer pays the Clef call,
      // everyone after gets it free (X-Cache: hit).
      const cacheTag = decision.cache === 'hit' ? ' cache=hit' : '';
      if (!decision.flag) {
        panel.log({ key, verdict: 'pass', extra: `slop=${decision.slopProb} ${ms}ms${cacheTag}` });
        seen.set(key, 'passed');
        return;
      }

      // Video may have advanced while we analyzed; only warn if still current.
      if (adapter.findActiveVideo() !== video || seen.get(key) === 'resumed') {
        seen.set(key, 'flagged'); // remember verdict if the user scrolls back
        return;
      }

      seen.set(key, 'flagged');
      panel.log({ key, verdict: 'flag', extra: `${decision.reason} slop=${decision.slopProb} ${ms}ms${cacheTag}` });
      video.pause();
      showOverlay(
        adapter.overlayHost(video),
        {
          label: CATEGORY_LABELS[decision.reason] ?? decision.reason ?? 'AI-generated content',
          slopProb: decision.slopProb,
          authenticity: decision.authenticity,
        },
        {
          onResume: () => {
            seen.set(key, 'resumed');
            video.play().catch(() => {});
          },
          onSkip: () => {
            if (!adapter.next()) video.play().catch(() => {}); // no next control: unstick
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
      panel.log({ key, verdict: 'err', extra: String(err?.message ?? err) });
      seen.set(key, 'passed');
    }
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
      const video = adapter.findActiveVideo();
      if (video) processVideo(video, adapter);
    } finally {
      ticking = false;
    }
  }

  const observer = new MutationObserver(tick);
  observer.observe(document.body, { childList: true, subtree: true });
  const intervalId = setInterval(tick, 800); // SPA navigations don't always mutate promptly
  tick();
})();
