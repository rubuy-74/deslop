# Instagram Reels Adapter Spike

Run this **logged in** on <https://www.instagram.com/reels/> with the feed
playing. Open devtools console, paste the script below, and paste the JSON
output back into this file (bottom section) or send it over.

Recon fact: logged-out `/reels/` is a PolarisErrorRoute JS shell — nothing is
discoverable statically, and Meta re-obfuscates classes per deploy, so this
probe deliberately avoids class names and mines structure instead.

Answers these questions:

1. What do the `<video>` elements look like (count, src type — `blob:` means
   canvas is likely clean; `fbcdn` https means the taint test decides)?
2. Is canvas extraction **tainted** (SecurityError) or clean?
3. What does the active video's ancestor chain look like (tags, roles,
   aria-labels, geometry) — what's a stable overlay host?
4. Does the URL sync to `/reel/<id>/` per reel? Any `a[href^="/reel/"]`?
5. What next-reel controls exist (chevrons, role=button aria-labels) and
   which input actually advances the feed (click / `j` / ArrowDown / scrollBy)?
6. Phase 3 inventory: any "AI info" labels, caption/description containers?

## The probe

```js
(async () => {
  const out = {};
  const videos = [...document.querySelectorAll('video')];
  out.videoCount = videos.length;
  out.videos = videos.slice(0, 5).map((v) => ({
    readyState: v.readyState,
    paused: v.paused,
    srcType: (v.currentSrc || v.src || 'none').startsWith('blob:') ? 'blob' : (v.currentSrc || v.src || 'none').slice(0, 80),
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
    // 3. ancestor chain: tag/role/aria/data-* + geometry (NO classes)
    const chain = [];
    let el = active;
    while (el && el !== document.body && chain.length < 12) {
      el = el.parentElement;
      if (!el) break;
      const r = el.getBoundingClientRect();
      const info = {
        tag: el.tagName,
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label'),
        dataAttrs: [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name),
        h: Math.round(r.height),
        w: Math.round(r.width),
      };
      if (info.role || info.aria || info.dataAttrs.length || ['ARTICLE', 'SECTION', 'MAIN'].includes(el.tagName)) {
        chain.push(info);
      }
    }
    out.ancestorChain = chain;
    // 4. canonical URL
    out.locationPath = location.pathname;
    const item = active.closest('article') ?? active.closest('section') ?? document;
    out.reelAnchor = item.querySelector('a[href^="/reel/"]')?.href ?? document.querySelector('a[href^="/reel/"]')?.href ?? null;
  }

  // 5. next-control candidates (fixed/overlay buttons + aria)
  out.buttonCandidates = [...document.querySelectorAll('[role="button"], button')]
    .filter((b) => b.getAttribute('aria-label'))
    .slice(0, 20)
    .map((b) => ({ tag: b.tagName, role: b.getAttribute('role'), aria: b.getAttribute('aria-label') }));

  // 6. Phase 3: AI labels + caption containers (text search, structural)
  out.aiLabelHits = [...document.querySelectorAll('span, div')]
    .filter((e) => /AI info|Made with AI|AI-generated/i.test(e.textContent ?? '') && e.children.length < 4)
    .slice(0, 5)
    .map((e) => e.textContent.trim().slice(0, 80));

  // 7. Warning overlay hit-testing and event delivery. This distinguishes a
  // CSS/stacking problem from a content-controller callback problem.
  const overlay = document.querySelector('.slop-overlay');
  const controls = overlay ? [...overlay.querySelectorAll('button')] : [];
  const clickLog = window.__slopReelsSpikeClicks ?? [];
  window.__slopReelsSpikeClicks = clickLog;
  for (const button of controls) {
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      button.addEventListener(type, () => clickLog.push({
        type,
        className: button.className,
        at: new Date().toISOString(),
      }), { capture: true });
    }
  }
  out.overlay = overlay ? {
    connected: overlay.isConnected,
    className: overlay.className,
    parent: overlay.parentElement?.tagName ?? null,
    rect: (() => { const r = overlay.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
    computed: (() => { const s = getComputedStyle(overlay); return { pointerEvents: s.pointerEvents, zIndex: s.zIndex, position: s.position, display: s.display }; })(),
    buttons: controls.map((button) => {
      const r = button.getBoundingClientRect();
      const s = getComputedStyle(button);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        text: button.textContent.trim(),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        computed: { pointerEvents: s.pointerEvents, zIndex: s.zIndex, display: s.display, visibility: s.visibility },
        hitTag: hit?.tagName ?? null,
        hitClass: hit?.className ?? null,
        hitIsButton: hit === button,
        ancestors: document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          .slice(0, 6)
          .map((el) => ({ tag: el.tagName, id: el.id, className: typeof el.className === 'string' ? el.className : null })),
      };
    }),
  } : null;
  out.overlayClickLog = clickLog;

  console.log('=== SLOP REELS SPIKE ===\n' + JSON.stringify(out, null, 2));
  console.log('After clicking Resume or Skip, run: JSON.stringify(window.__slopReelsSpikeClicks, null, 2)');
})();
```

## Skip-mechanism tests (one at a time, watch the feed)

```js
// (a) chevron/button — replace with a selector from buttonCandidates
document.querySelector('[role="button"][aria-label*="next" i]')?.click();

// (b) Instagram 'j' shortcut
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', keyCode: 74, which: 74, bubbles: true }));

// (c) ArrowDown
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));

// (d) scroll
window.scrollBy(0, window.innerHeight);
```

## Spike output (2026-10-02, logged-in /reels/)

Key findings:

- `videoCount: 10` — IG keeps a ~10-element video pool, one playing. `findActiveVideo`'s `!paused` preference handles it.
- **`taint: CLEAN (11844 bytes)`** — blob: srcs, canvas capture works (3/3 platforms clean).
- `locationPath: /reels/DdzR_FexztW/` — URL syncs per reel (plural `/reels/`); `reelAnchor: null` (no canonical anchor in item).
- Ancestor chain: only MAIN (role=main) and SECTION, both **full viewport width (1175px)** — semantic fallback would overshoot; geometry heuristic (narrow frame) is the primary path.
- **Skip VERIFIED**: `[role="button"][aria-label*="next" i]` ("Navigate to next Reel") click advances the feed. `j`, `ArrowDown`, `scrollBy` verified NON-working (kept as inert fallbacks).
- `aiLabelHits: []` — no Meta "AI Info" label on this reel (labels only appear on labeled content; Phase 3 note stands).

## Selector changes applied after spike (v0.3.1)

- `videoKey`: precise `/^\/reels?\//` match (verified `/reels/<id>/` plural form)
- `nextButtons`: aria-label next control confirmed working — stays primary; fallbacks annotated as verified-inert
- `_item`: documented that MAIN/SECTION overshoot (full-width) — geometry heuristic is load-bearing
- Canvas capture: CONFIRMED clean (blob: srcs)

## Control probe finding (2026-10-11)

- The overlay received the button interaction, but Resume/Skip threw
  `ReferenceError: Cannot access 'remove' before initialization` before the
  action callback ran. The fixed-root and in-host teardown functions are now
  initialized before binding button handlers.
- The verified Instagram next control is a global fixed control outside the
  narrow Reel item. Skip no longer filters document-level next controls by Reel
  container, and no longer dispatches the spike-proven inert keyboard/scroll
  fallbacks.
