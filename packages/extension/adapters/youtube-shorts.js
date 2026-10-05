/**
 * YouTube Shorts platform adapter.
 *
 * ALL platform-specific knowledge lives here — selectors, player structure,
 * skip mechanism. When YouTube ships a DOM change, this file (and only this
 * file) is expected to need edits. Keep selectors centralized and defensive.
 */

const SELECTORS = {
  // The Shorts feed renders one ytd-reel-video-renderer per short.
  reelRenderer: 'ytd-reel-video-renderer',
  video: 'ytd-reel-video-renderer video',
  // "Next short" control — YouTube has used several over time; try in order.
  nextButton: [
    '#navigation-button-down button',
    'ytd-shorts #next-button button',
    'button[aria-label="Next video"]',
    'button[aria-label="Next"]',
  ],
};

export const YoutubeShortsAdapter = {
  name: 'youtube-shorts',

  /** Original in-container overlay works here — no transform stacking trap. */
  overlayStrategy: 'in-host',

  matches(location) {
    return /(^|\.)youtube\.com$/.test(location.hostname) && location.pathname.startsWith('/shorts');
  },

  /**
   * The currently playing (or about-to-play) video in the viewport.
   * Cheap rect check rather than IntersectionObserver: polling cadence
   * makes this good enough for the feed's snap-to-video behavior.
   */
  findActiveVideo() {
    const videos = [...document.querySelectorAll(SELECTORS.video)];
    const visible = videos.filter((v) => {
      const r = v.getBoundingClientRect();
      return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    return visible.find((v) => !v.paused && v.readyState >= 2) ?? visible[0] ?? null;
  },

  /** Stable identity for dedup — survives element reuse because src changes. */
  videoKey(video) {
    return video.currentSrc || video.src || null;
  },

  /**
   * Canonical share URL for the shared verdict cache — the feed syncs the
   * page URL to the active short (/shorts/<id>). Null when it hasn't synced
   * yet (feed root): blob: srcs stay uncacheable, by design.
   */
  canonicalUrl() {
    return /^\/shorts\/[^/]+/.test(location.pathname) ? location.href : null;
  },

  /**
   * Container we absolutely-position the warning overlay into.
   * Must be the VIDEO FRAME, not the reel renderer — the renderer spans
   * most of the viewport (video + action sidebar + metadata), which made
   * the overlay blur the whole screen. #player-container wraps just the
   * portrait player; fallbacks shrink gracefully.
   */
  overlayHost(video) {
    return (
      video.closest('#player-container') ??
      video.parentElement ??
      video.closest(SELECTORS.reelRenderer)
    );
  },

  /** Skip = exactly what the user's own tap would do. */
  next() {
    for (const sel of SELECTORS.nextButton) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  },
};
