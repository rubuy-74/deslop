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

export const InstagramReelsAdapter = {
  name: 'instagram-reels',

  /** Feed containers use CSS transforms (snap animation) → z-index trap;
   *  overlay must render at document root, rect-tracked. */
  overlayStrategy: 'fixed-root',

  matches(location) {
    return /(^|\.)instagram\.com$/.test(location.hostname);
  },

  /** Currently playing (or about-to-play) video in the viewport. */
  findActiveVideo() {
    const videos = [...document.querySelectorAll(SELECTORS.video)];
    const visible = videos.filter((v) => {
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

  /**
   * Skip = exactly what the user's own input would do.
   * Order: chevron/next button (if present — spike verifies) -> Instagram's
   * keyboard shortcut 'j' (next post on IG surfaces) -> ArrowDown with full
   * event properties (pattern proven on TikTok) -> window.scrollBy.
   */
  next() {
    for (const sel of SELECTORS.nextButtons) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    const target = document.body ?? document;
    for (const init of [
      { key: 'j', code: 'KeyJ', keyCode: 74 },
      { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    ]) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { ...init, which: init.keyCode, bubbles: true, cancelable: true })
      );
    }
    window.scrollBy(0, window.innerHeight);
    return true;
  },
};
