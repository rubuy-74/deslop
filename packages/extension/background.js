/**
 * Background service worker: the only component that talks to the Worker.
 * Receives captured frames from content scripts, proxies them to the
 * deployed Cloudflare Worker (with the shared-secret header), and returns
 * the engine's decision. Keeping the fetch here keeps the token out of
 * page reach and the request out of the platform's page CSP.
 */

import { analyze, decide } from './vendor/engine.js';

const DEFAULTS = {
  workerUrl: 'https://slop-rotting-worker.rubemviscard2635.workers.dev/analyze',
  token: '',
};

// Optional bundled defaults for unpacked installs (gitignored file).
// NOTE: dynamic import() is disallowed in service workers, so this is a
// JSON file loaded via fetch — both constraints satisfied.
let localCfgPromise;
function loadLocalCfg() {
  localCfgPromise ??= fetch(chrome.runtime.getURL('config.local.json'))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({})); // file is optional
  return localCfgPromise;
}

/** Precedence: chrome.storage (options page) > config.local.js > DEFAULTS. */
async function getConfig() {
  const [stored, localCfg] = await Promise.all([chrome.storage.sync.get(DEFAULTS), loadLocalCfg()]);
  return {
    workerUrl: stored.workerUrl || localCfg.workerUrl || DEFAULTS.workerUrl,
    token: stored.token || localCfg.token || '',
  };
}

/**
 * Stable random install ID (X-Install-Id) — the Worker's per-install daily
 * quota counter. Generated once with crypto.randomUUID, kept in
 * chrome.storage.local. Random by construction: it encodes nothing about
 * the user, and the Worker only ever stores a count next to it.
 * Fail-open: without it the Worker simply doesn't enforce quota.
 */
async function getInstallId() {
  try {
    const { installId } = await chrome.storage.local.get('installId');
    if (installId) return installId;
    const fresh = crypto.randomUUID();
    await chrome.storage.local.set({ installId: fresh });
    return fresh;
  } catch {
    return null;
  }
}

async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ping') {
    (async () => {
      try {
        const { workerUrl, token } = await getConfig();
        // POST with no body: authed -> 400 (no frames), wrong token -> 401.
        const res = await fetch(workerUrl, {
          method: 'POST',
          headers: token ? { 'X-Slop-Token': token } : undefined,
        });
        sendResponse({ ok: res.status !== 401, status: res.status, hasToken: !!token });
      } catch (err) {
        sendResponse({ ok: false, status: String(err?.message ?? err) });
      }
    })();
    return true;
  }

  if (msg?.type === 'feedback') {
    (async () => {
      try {
        const [{ workerUrl, token }, installId] = await Promise.all([getConfig(), getInstallId()]);
        const feedbackUrl = new URL(workerUrl);
        feedbackUrl.pathname = '/feedback';
        const res = await fetch(feedbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-Slop-Token': token } : {}),
            ...(installId ? { 'X-Install-Id': installId } : {}),
          },
          body: JSON.stringify(msg.report),
        });
        const body = await res.json().catch(() => ({}));
        sendResponse({ ok: res.ok, key: body.key ?? null, error: body.error ?? (res.ok ? null : `HTTP ${res.status}`) });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      }
    })();
    return true;
  }

  if (msg?.type !== 'analyze' || !Array.isArray(msg.frames)) return false;

  (async () => {
    try {
      const [{ workerUrl, token }, installId] = await Promise.all([getConfig(), getInstallId()]);
      const blobs = await Promise.all(msg.frames.map(dataUrlToBlob));
      const response = await analyze(blobs, {
        workerUrl,
        token,
        installId,
        model: msg.model,
        platform: typeof msg.platform === 'string' ? msg.platform : undefined,
        videoId: typeof msg.videoId === 'string' ? msg.videoId : undefined,
      });
      sendResponse({
        decision: decide(response.answers),
        usage: response.usage ?? null,
        cache: response.cache ?? null,
      });
    } catch (err) {
      // Fail open: a classifier outage must never break playback.
      sendResponse({
        decision: { flag: false, error: String(err?.message ?? err), quota: err?.quota === true },
      });
    }
  })();

  return true; // async sendResponse
});

// Toolbar icon click = the one user-visible entry point to settings/status.
chrome.action?.onClicked?.addListener(() => chrome.runtime.openOptionsPage());
