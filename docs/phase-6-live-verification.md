# Phase 6 live verification (manual QA)

Use this checklist to verify live behavior only. **Do not change runtime code in this phase.**

## 1) Setup (once per run)

1. Build the extension payload:
   ```sh
   cd /home/runner/work/deslop/deslop
   npm run build -w packages/extension
   ```
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select:
   `/home/runner/work/deslop/deslop/packages/extension`
3. Open extension **Details** → **Extension options**.
4. Enable the Phase 0 opt-in diagnostics toggle:
   - `Debug panel — live analysis log & report button`
   - Save, then reload already-open Shorts/TikTok/Reels tabs.
5. Open DevTools:
   - **Content script console**: page DevTools Console on each platform tab.
   - **Service worker console**: `chrome://extensions` → this extension → **service worker** link.
   - **Network**: on each platform tab, filter `analyze` (or Worker URL), preserve log on.

## 2) Privacy-safe logging rules (required)

- Collect only: timestamps, platform, request counts, response status, cache markers, and durations.
- Do **not** save or paste page text, captions/comments, account/profile data, full URLs with personal info, video frames, screenshots of feed content, cookies, or auth tokens.

## 3) Manual QA checklist

Mark each row Pass/Fail with short evidence.

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| Q1 | Clean install on already-open tabs | Keep Shorts/Reels/TikTok tabs open, install/load extension, reload tab only if required by documented behavior | Content script initializes once per supported tab; no duplicate overlays/controllers |
| Q2 | Browser restart | With supported tabs present, fully restart browser and reopen session | Extension recovers; supported tabs analyze normally; no stale overlays |
| Q3 | Extension reload | Reload extension from `chrome://extensions` while supported tab is open | Re-initializes safely; no duplicate UI or broken playback |
| Q4 | SPA transitions | Navigate within same tab across supported routes and back (no full refresh) | Analysis starts/stops with context changes; no stuck warning |
| Q5 | Logged-in supported contexts | Verify while logged in: Instagram Reels, YouTube Shorts, TikTok For You/feed | Active videos can be analyzed and warned/pass correctly |
| Q6 | Unsupported contexts | Visit profile/search/home/non-reel pages on each platform | No analysis request, no warning overlay |
| Q7 | Rapid scroll stress (>=10 videos) | Fast-skip/scroll through at least ten videos per platform | No queued stale overlays; only current video can be paused/warned |
| Q8 | Instagram Resume timing | Trigger IG warning, click **Resume** quickly and repeatedly | First click resumes promptly; repeated clicks are idempotent/no errors |
| Q9 | Instagram Skip timing | Trigger IG warning, click **Skip** quickly and repeatedly | Advances or safely fails open; repeated clicks do not break controls |
| Q10 | Stale overlay teardown | Change video/source/route while warning is visible | Previous overlay is removed; no orphaned overlay remains |
| Q11 | Request counting | Use debug logs + Network to count analyze requests during Q5–Q10 | Counts align with visible active-video analyses (no runaway bursts) |
| Q12 | Latency p50/p90 | From diagnostics durations, compute p50/p90 request latency (and total if logged) | Values recorded; outliers noted with scenario context |
| Q13 | Service-worker injection errors | Check service-worker console during install/reload/open-tab flows | No uncaught injection errors; handled errors do not break playback |

## 4) Result template

Copy/paste and fill:

```md
### Phase 6 live verification run
- Date/Time (UTC):
- Tester:
- Browser + version:
- Extension version/commit:
- Diagnostics enabled (Debug panel): yes/no

#### Environment
- Logged-in accounts used: IG / YouTube / TikTok (yes/no only)
- Worker URL host:

#### Checklist results
| ID | Pass/Fail | Evidence (privacy-safe) |
|---|---|---|
| Q1 |  |  |
| Q2 |  |  |
| Q3 |  |  |
| Q4 |  |  |
| Q5 |  |  |
| Q6 |  |  |
| Q7 |  |  |
| Q8 |  |  |
| Q9 |  |  |
| Q10 |  |  |
| Q11 |  |  |
| Q12 |  |  |
| Q13 |  |  |

#### Metrics
- Analyze request count (total):
- Request count by platform (YT/TikTok/IG):
- Request latency p50 (ms):
- Request latency p90 (ms):
- Total decision latency p50/p90 (ms, if available):

#### Errors observed
- Service-worker injection errors:
- Content-script errors:
- Network failures/timeouts:

#### Notes / follow-ups
- 
```
