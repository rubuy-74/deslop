/**
 * TikTok web platform adapter.
 *
 * ALL platform-specific knowledge lives here — selectors, player structure,
 * skip mechanism. TikTok ships A/B DOM changes frequently; when this file
 * breaks, the fix belongs here only. Selector candidates were written from
 * static recon (tiktok.com/foryou is a pure JS shell) and get hardened by
 * the live spike (SPIKE.md).
 */

const SELECTORS = {
  video: 'video',
  // Feed item container — VERIFIED by live spike (2026-10-02): the active
  // video's ancestor chain is [data-e2e="feed-video"] inside
  // [data-e2e="recommend-list-item-container"]. Wildcards kept as fallback.
  itemContainers: [
    '[data-e2e="recommend-list-item-container"]',
    '[data-e2e="feed-video"]',
    '[data-e2e*="feed-item"]',
  ],
  // Canonical /@user/video/<id> anchor inside a feed item.
  // (Spike: null — TikTok syncs the page URL instead; see videoKey.)
  videoLink: 'a[href*="/video/"]',
};

export const TiktokAdapter = {
  name: 'tiktok',

  /** Original in-container overlay works here — no transform stacking trap. */
  overlayStrategy: 'in-host',

  matches(location) {
    return /(^|\.)tiktok\.com$/.test(location.hostname);
  },

  /**
   * The currently playing (or about-to-play) video in the viewport.
   * The feed is fully client-rendered; callers poll, so an early null here
   * just means hydration hasn't happened yet.
   */
  findActiveVideo() {
    const videos = [...document.querySelectorAll(SELECTORS.video)];
    const visible = videos.filter((v) => {
      const r = v.getBoundingClientRect();
      return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    return visible.find((v) => !v.paused && v.readyState >= 2) ?? visible[0] ?? null;
  },

  /**
   * Stable identity. Spike finding: no canonical anchor is rendered in the
   * item — but TikTok syncs the page URL to the ACTIVE video, so location.href
   * (a /@user/video/<id> URL) is the best key when present. Blob currentSrc
   * fallback handles /foryou and element reuse (src swaps = new key).
   */
  videoKey(video) {
    if (location.pathname.includes('/video/')) return location.href;
    const item = this._item(video);
    const link = item?.querySelector(SELECTORS.videoLink)?.href;
    return link ?? video.currentSrc ?? video.src ?? null;
  },

  /**
   * Canonical /@user/video/<id> URL for the shared verdict cache. Same
   * spike finding as videoKey: TikTok syncs the page URL to the active
   * video, so location.href is canonical when on a /video/ path. Null in
   * /foryou (URL not synced yet): blob srcs stay uncacheable.
   */
  canonicalUrl() {
    return location.pathname.includes('/video/') ? location.href : null;
  },

  /**
   * Container we absolutely-position the warning overlay into.
   * Must be the VIDEO FRAME (feed-video — verified in the spike as the
   * direct video wrapper), not recommend-list-item-container, which spans
   * the full row including the action bar → whole-screen blur otherwise.
   */
  overlayHost(video) {
    return (
      video.closest('[data-e2e="feed-video"]') ??
      this._item(video) ??
      video.parentElement
    );
  },

  _item(video) {
    for (const sel of SELECTORS.itemContainers) {
      const el = video.closest(sel);
      if (el) return el;
    }
    return null;
  },

  /**
   * Skip = exactly what the user's own input would do.
   * Spike findings: (a) NO arrow buttons exist in the DOM on desktop FYP;
   * (b) a synthetic ArrowDown REACHED TikTok's keydown handler but crashed it
   * because the event lacked code/keyCode — so we dispatch a fully-populated
   * event. If the feed still doesn't advance, plan B is window.scrollBy
   * (unverified whether FYP uses native scroll or wheel-event snapping).
   */
  next() {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      code: 'ArrowDown',
      keyCode: 40,
      which: 40,
      bubbles: true,
      cancelable: true,
    });
    (document.body ?? document).dispatchEvent(event);
    return true;
  },
};
