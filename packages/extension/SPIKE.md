# TikTok Adapter Spike

Run this **logged in** on <https://www.tiktok.com/foryou> with the feed playing.
Open devtools console, paste the script below, and paste the JSON output back
into this file (bottom section) or send it over — the adapter selectors get
hardened from it.

Answers these questions:

1. What do the `<video>` elements look like (count, src type — `blob:` means
   canvas capture is likely untainted like YouTube)?
2. Is canvas extraction **tainted** (SecurityError) or clean?
3. What are the real runtime `data-e2e` values on the feed item and nav arrows?
4. Is a canonical `/@user/video/<id>` anchor available inside the item?
5. Which skip mechanism actually advances the feed (arrow click / scrollBy /
   ArrowDown)?

## The probe

```js
(async () => {
  const out = {};
  const videos = [...document.querySelectorAll('video')];
  out.videoCount = videos.length;
  out.videos = videos.slice(0, 5).map((v) => ({
    readyState: v.readyState,
    paused: v.paused,
    srcType: (v.currentSrc || v.src || 'none').startsWith('blob:') ? 'blob' : (v.currentSrc || v.src || 'none').slice(0, 60),
    heightOnScreen: Math.round(v.getBoundingClientRect().height),
  }));

  const active = videos.find((v) => !v.paused && v.readyState >= 2) ?? videos[0];
  if (active) {
    // 2. canvas taint test
    try {
      const c = document.createElement('canvas');
      c.width = 270; c.height = 480;
      c.getContext('2d').drawImage(active, 0, 0, 270, 480);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.65));
      out.taint = blob ? `CLEAN (${blob.size} bytes)` : 'toBlob returned null';
    } catch (e) {
      out.taint = 'TAINTED: ' + e.message;
    }
    // 3. container discovery: walk up the data-e2e chain
    const chain = [];
    let el = active;
    while (el && chain.length < 10) {
      el = el.parentElement;
      if (el?.dataset?.e2e) chain.push(el.dataset.e2e);
    }
    out.e2eAncestorChain = chain;
    const item = active.closest('[data-e2e]');
    // 4. canonical anchor
    const link = (item ?? document).querySelector('a[href*="/video/"]');
    out.canonicalHref = link?.href ?? null;
  }

  // 3b. full data-e2e inventory (first 60)
  out.e2eInventory = [...new Set([...document.querySelectorAll('[data-e2e]')].map((e) => e.dataset.e2e))].slice(0, 60);

  // nav-arrow candidates
  out.arrowCandidates = [...document.querySelectorAll('[data-e2e*="arrow" i], button[aria-label*="next" i], [data-e2e*="switch" i]')]
    .slice(0, 10)
    .map((b) => ({ tag: b.tagName, e2e: b.dataset?.e2e ?? null, aria: b.getAttribute('aria-label') }));

  console.log('=== SLOP SPIKE ===\n' + JSON.stringify(out, null, 2));
})();
```

## Skip-mechanism tests (run one at a time, watch the feed)

```js
// (a) arrow click — replace selector with what the inventory shows
document.querySelector('[data-e2e*="arrow"] button')?.click();

// (b) scroll
window.scrollBy(0, window.innerHeight);

// (c) keyboard
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
```

## Spike output (2026-10-02, logged-in FYP)

```json
{
  "videoCount": 2,
  "videos": [
    { "readyState": 4, "paused": false, "srcType": "blob", "heightOnScreen": 915 },
    { "readyState": 4, "paused": true,  "srcType": "blob", "heightOnScreen": 915 }
  ],
  "taint": "CLEAN (13430 bytes)",
  "e2eAncestorChain": ["feed-video", "recommend-list-item-container"],
  "canonicalHref": null,
  "arrowCandidates": []
}
```

Notable inventory entries: `aigc-tag` (TikTok's own AI-content label — Phase 3
signal candidate), `video-desc` / `desc-span-*` (description text — Phase 3
text-signal candidate).

Skip tests: arrow click = no-op (no such element); `scrollBy` effect
unverified; synthetic `ArrowDown` (key-only) REACHED TikTok's handler but
crashed it (`toLocaleLowerCase` of undefined) — proving delivery, missing
`code`/`keyCode`.

## Selector changes applied after spike (v0.2.1)

- `itemContainers`: hardened to verified `recommend-list-item-container` → `feed-video` chain
- `videoKey`: `location.href` when pathname contains `/video/` (TikTok syncs URL to active video; `canonicalHref` was null)
- `next()`: arrow buttons removed (verified absent); dispatches fully-populated ArrowDown (key+code+keyCode+which)
- Canvas capture: CONFIRMED clean (blob: srcs, no taint)
