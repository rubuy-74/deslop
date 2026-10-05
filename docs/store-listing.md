# Chrome Web Store listing — ready-to-paste (for the later submission)

Everything needed for the submission, prepared in advance per the "public
afterwards, but written down now" decision. Nothing here is live yet.

## Listing identity

- **Name:** Slop Rotting
- **Summary (≤132 chars):**
  `Warns before you watch AI-generated slop on Shorts, TikTok and Reels. Warn-only — never blocks playback.`
- **Category:** Productivity
- **Language:** English

## Description

```
Short-form feeds are filling up with AI-generated slop — plastic "absurdity
bait", face-swap parodies, static AI slideshows. Slop Rotting watches the
video you're about to watch and throws a blur warning over likely
AI-generated content BEFORE you sit through it.

• Works on YouTube Shorts, TikTok and Instagram Reels
• Warn-only: every failure path fails OPEN — a broken classifier never
  blocks your feed, it just plays
• One clear signal before playback: [Resume] to watch anyway, [Skip] to jump
  to the next video — or hit "Got it wrong?" to report a bad call and
  improve the model
• Privacy-first: three tiny downscaled frames of the video you're already
  watching go to the classifier — never your history, identity or account.
  See the privacy policy for the complete inventory.

Fail-open by design. Warn-only by design. The first viewer of a video pays
the analysis; everyone else gets the shared verdict.
```

## Single purpose statement (review form)

> Detect likely AI-generated short-form videos and warn the user before
> playback, without ever blocking or modifying platform content beyond the
> extension's own warning overlay.

## Permission justifications (review form)

- `storage` — stores the user's Worker URL/shared-secret settings and a
  random install ID used solely as the daily-analysis counter key. No
  browsing data.
- Host permissions (`youtube.com`, `tiktok.com`, `instagram.com`) — read
  video frames from the page for classification, and render the warning
  overlay. No data is written to the pages, no platform content is modified.
- Host permission (the analysis Worker, `slop-rotting-worker.<account>.workers.dev`)
  — sends the frames to the classifier from the background service worker
  (keeps the request out of the page's CSP).

## Graphics checklist

- [x] Icon 128×128 (`packages/extension/icons/icon-128.png`) + 16/32/48 in
      the manifest
- [ ] Screenshots, 1280×800, up to 5, suggested set:
      1. YouTube Shorts warning overlay (flag, [Resume]/[Skip]/[Got it wrong?])
      2. TikTok warning overlay
      3. Instagram Reels warning overlay
      4. Options page (worker URL + token fields)
      5. (optional) Debug panel collapsed in corner — shows the live log
- [ ] Small promo tile 440×280 (optional but recommended)
- [ ] Reuse `icons/icon-128.png` as the store icon base

## Publishing steps (when the time comes)

1. `$5` one-time developer registration fee
   (<https://chrome.google.com/webstore/devconsole>)
2. Build the artifact: `cd packages/extension && npm run zip`
   → `dist/slop-rotting-<version>.zip` (vendor staged fresh; token baked
   from `config.local.json`; the script refuses a tokenless build)
3. Upload in the dev console; paste the listing fields above
4. Privacy policy URL: link to `PRIVACY.md` in the public repo
   (this file is written to double as the store privacy policy)
5. Submit for review — reviewer notes (if the form asks):
   - No remote code: all scripts including the engine (`vendor/`) are
     bundled in the zip
   - The debug/feedback panel ships deliberately — it is the wrong-verdict
     reporting UI, not a dev leftover; it is collapsed by default
   - The shared secret in `config.local.json` is an abuse filter for our own
     API costs, not user-facing security (documented in PRIVACY.md)
6. Version bump policy: manifest `version` + git tag before each
   `npm run zip`

## Token notes (decided)

Baked-token approach: the store build embeds the Worker shared secret in
`config.local.json`. It is extractable by anyone who unzips the extension —
accepted, because it's only a casual-abuse filter; the real backstops are
the per-install daily quota (300 Clef-calling analyses, cache hits free), the
shared verdict cache (30-day TTL), and the Cloudflare rate-limiting rule on
the Worker route (set in the dashboard, not in code).
