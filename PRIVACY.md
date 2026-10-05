# Privacy Policy — deslop

Last updated: 2026-10-05

deslop is a warn-only browser extension that flags likely
AI-generated short-form videos. This document is the complete inventory of
what the extension touches, sends, and stores — it doubles as the Chrome
Web Store privacy policy.

## The one-sentence version

The extension sends three small screenshots of the video you are already
watching to a classifier, keeps nothing about you, and the backend stores
only verdicts about video URLs and an anonymous daily counter.

## What happens inside your browser

- On YouTube Shorts, TikTok, and Instagram Reels, the content script finds
  the currently playing `<video>` element and captures **3 downscaled
  frames (270×480, WebP)** from live playback. Frames never leave the
  browser except as part of an analysis request.
- Every analysis result is applied **locally** (pause + warning overlay, or
  nothing). Nothing is ever blocked: on any error the video simply plays.
- A random **install ID** (a `crypto.randomUUID()` value generated on first
  use) is stored in `chrome.storage.local` and reused. It is not derived
  from your identity, account, or history.
- Your settings (Worker URL, shared secret) live in `chrome.storage.sync`.

## What is sent, per analysis

To the analysis Worker (Cloudflare), and from there to the
`@cf/cloudflare/clef-flash` vision model:

| Field | Value | Purpose |
|---|---|---|
| frames | 3 downscaled WebP images (270×480, ~45 KB each max) | the classification input |
| platform | `youtube-shorts` / `tiktok` / `instagram-reels` | verdict cache key |
| videoId | the video's canonical URL, or an opaque `blob:` session URL | verdict cache key |
| installId header | random UUID | daily quota counter |
| state / questions / model | the classification prompt | classification |

## What is sent when YOU report a verdict (voluntary)

From the warning overlay ("not slop?") or the debug panel ("report slop"),
if you choose to send it: the frames for that video, the engine's verdict,
your optional free-text comment, the video URL, and the install ID. This
becomes the fine-tuning dataset. It is never sent automatically.

## What the backend stores

- **Verdict cache (Cloudflare KV):** video URL → verdict, 30-day TTL.
  Verdicts about *videos*, never about users. A report deletes the cached
  verdict so the next viewer triggers a fresh analysis.
- **Quota counters (Cloudflare KV):** install ID + date → count, 25-hour
  TTL. The stored value is a number next to a random UUID — nothing else.
- **Feedback reports (Cloudflare R2):** the voluntary reports described
  above.

## What is never collected

No accounts, no names or emails, no browsing history, no feed contents
beyond the frames of the video being classified, no cookies, no analytics,
no third-party trackers, no advertising identifiers. Nothing is sold,
shared, or used for any purpose other than classifying videos and improving
the classifier from voluntary feedback.

## Where data is processed

The analysis Worker and the Workers AI model run on Cloudflare's
infrastructure (EU/US regions per Cloudflare's routing). Frames are
processed in memory; only the items listed above persist.

## Your controls

- The options page (click the toolbar icon) lets you point the extension at
  any Worker you trust — including one you deploy yourself from this
  repository, in which case you control every byte stored.
- Feedback is strictly opt-in per report.
- Removing the extension deletes the install ID and settings.

## Contact

Open an issue in this repository for any privacy question or data deletion
request concerning feedback reports (reports are keyed by timestamp and can
be deleted on request).
