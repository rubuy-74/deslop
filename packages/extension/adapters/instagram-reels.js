/**
 * Instagram Reels platform adapter.
 *
 * ALL platform-specific knowledge lives here. Constraint from recon:
 * Instagram's logged-out /reels/ is a PolarisErrorRoute JS shell with ZERO
 * discoverable DOM, and Meta re-obfuscates class names on every deploy —
 * so selectors must be STRUCTURAL only (video, article/section, role,
 * aria-label, geometry heuristics). Never select by class name.
 * Candidates are hardened by the live spike (SPIKE-REELS.md).
 */

const SELECTORS = {
  video: 'video',
  // Next-control candidates, checked in order. VERIFIED by live spike
  // (2026-10-02): [role="button"][aria-label*="next" i] = "Navigate to next
  // Reel" exists and clicking it advances the feed. j/ArrowDown/scrollBy
  // were verified NON-working but kept as inert fallbacks for DOM drift.
  nextButtons: [
    '[role="button"][aria-label*="next" i]',
    '[role="button"][aria-label*="down" i]',
    'button[aria-label*="next" i]',
  ],
  // Canonical /reel/<id> anchor inside an item (spike verifies presence).
  videoLink: 'a[href^="/reel/"]',
};

export function isUsableNextControl(control) {
  if (!control?.isConnected || control.disabled || control.getAttribute?.('aria-disabled') === 'true') return false;
  const rect = control.getBoundingClientRect?.();
  return !rect || (rect.width > 0 && rect.height > 0);
}

function waitForAdvance(previous, findActiveVideo, identity, timeoutMs = 1200) {
  const started = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const current = findActiveVideo();
      if (identity(current) && identity(current) !== previous) {
        resolve(true);
        return;
      }
      if (performance.now() - started >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

export const InstagramReelsAdapter = {
  name: 'instagram-reels',

  /** Feed containers use CSS transforms (snap animation) → z-index trap;
   *  overlay must render at document root, rect-tracked. */
  overlayStrategy: 'fixed-root',

  matches(location) {
    return /(^|\.)instagram\.com$/.test(location.hostname);
  },

  /** The verified supported surface is the dedicated Reels feed. */
  supportsContext(location) {
    return /^\/reels(?:\/|$)/.test(location.pathname);
  },

  /** Currently playing (or about-to-play) video in the viewport. */
  findActiveVideo() {
    const videos = [...document.querySelectorAll(SELECTORS.video)];
    const visible = videos.filter((v) => {
      const item = this._item(v);
      if (!item || !this._looksLikeReelItem(item)) return false;
      const r = v.getBoundingClientRect();
      return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    return visible.find((v) => !v.paused && v.readyState >= 2) ?? visible[0] ?? null;
  },

  /**
   * Stable identity. VERIFIED by spike: the URL syncs to /reels/<id>/ per
   * reel (plural), and no canonical anchor is rendered in the item.
   * Blob currentSrc fallback covers non-synced states and element reuse
   * (IG keeps a ~10-element video pool and swaps sources).
   */
  videoKey(video) {
    if (/^\/reels?\//.test(location.pathname)) return location.href;
    const item = this._item(video);
    const link = item?.querySelector(SELECTORS.videoLink)?.href;
    return link ?? video.currentSrc ?? video.src ?? null;
  },

  /**
   * Canonical URL for the shared verdict cache. Spike finding: the URL
   * syncs to /reels/<id>/ (plural) per reel — same source as videoKey.
   * Null when not synced: blob srcs stay uncacheable.
   */
  canonicalUrl() {
    return /^\/reels?\//.test(location.pathname) ? location.href : null;
  },

  /** Container we absolutely-position the warning overlay into. */
  overlayHost(video) {
    return this._item(video) ?? video.parentElement;
  },

  /**
   * Class-free container discovery: the reel frame is a TALL, NARROW-ish
   * ancestor of the video. Spike finding: the only semantic ancestors are
   * MAIN/SECTION at FULL viewport width — they would overshoot, so the
   * geometry heuristic (width < 80% viewport) is the primary path and the
   * semantic fallback is last resort only.
   */
  _item(video) {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let el = video.parentElement;
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.height >= vh * 0.5 && r.height <= vh * 1.3 && r.width < vw * 0.8) {
        return el;
      }
      el = el.parentElement;
    }
    return video.closest('article') ?? video.closest('section');
  },

  _looksLikeReelItem(item) {
    const r = item.getBoundingClientRect();
    return r.height >= window.innerHeight * 0.5
      && r.height <= window.innerHeight * 1.3
      && r.width < window.innerWidth * 0.8;
  },

  /**
   * Skip uses Instagram's verified global next-Reel control. The control is
   * outside the narrow Reel item in the live DOM, so scoping document-level
   * candidates to the item incorrectly hides the real navigation button.
   */
  async next() {
    const current = this.findActiveVideo();
    const identity = (video) => video ? `${this.videoKey(video)}:${video.currentSrc || video.src || ''}` : null;
    const before = identity(current);
    const controls = [];
    for (const sel of SELECTORS.nextButtons) {
      controls.push(...document.querySelectorAll(sel));
    }
    const button = [...new Set(controls)].find(isUsableNextControl);
    if (button) {
      button.click();
      if (await waitForAdvance(before, () => this.findActiveVideo(), identity)) return 'advanced';
    }
    return 'resumed';
  },
};
