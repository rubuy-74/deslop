# Extension Diagnostics

Diagnostics are disabled by default. Enable **Development diagnostics** on the
options page, save, and reload the supported tab under test. The setting is
stored in `chrome.storage.sync`; diagnostics remain in memory in the content
script and are never sent to the Worker.

The panel shows one expandable card per analyzed video. Each card has readable
capture, worker message count, worker round-trip time, detected type, model
type confidence, result, cache, and total-time fields, followed by a timeline
of measurable stages. Worker messages counts messages sent from the content
script to the extension worker for that video. The exported JSON contains only timestamps, platform
names, opaque job numbers, event outcomes, request counts, and timings. It does
not contain URLs, page text, account data, cookies, or video frames. The event
buffer is capped at 500 events. The summary includes analysis count, request
count, and total-latency p50/p90.

## Reproduction Checklist

### Clean install and first use

1. Remove the unpacked extension and install it again.
2. Open supported YouTube Shorts, TikTok, and Instagram Reels tabs before and
   after enabling diagnostics.
3. Confirm the content script starts without a manual refresh where the browser
   permits existing-tab activation.
4. Export diagnostics after the first active video and record request count and
   total latency.

### Rapid scrolling

1. Enable diagnostics and open a supported feed.
2. Scroll past at least ten videos quickly, then stop on one video for several
   seconds.
3. Export diagnostics and compare request count with the number of videos that
   remained active long enough to analyze.
4. Check for stale decisions or more than one visible overlay.
5. Expand each visible video card and verify its request and decision events
   belong to that video.

### Instagram controls

1. Enable diagnostics on a logged-in Instagram Reels feed.
2. Wait for a warning, then click **Resume** and repeat with **Skip**.
3. Confirm Resume records `overlay.resume` and playback continues.
4. Confirm Skip records `overlay.skip` with `advanced` or `resumed`, and the
   feed is not left paused.
5. Expand the card and verify the skip result appears in its timeline.
