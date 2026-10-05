# deslop

deslop is a warn-only anti-slop layer for short-form video feeds.

Landing page: <https://deslop-worker.rubemviscard2635.workers.dev> — a
one-page static site served from `packages/worker/public/` on the same
Worker (file-matching GETs hit static assets; the API routes are untouched).
The extension watches YouTube Shorts, TikTok, and Instagram Reels, sends a few
downscaled frames of each video to a vision model, and throws a blur-scrim
warning over likely AI-generated content before you watch it. It never blocks
playback: every failure path — model error, timeout, quota exhausted —
fails **open**.

```
YouTube Shorts · TikTok · Instagram Reels
   │  content script: platform adapter finds the active video,
   │  captures 3 frames (270×480 WebP) from live playback — no seeking
   ▼
background service worker
   │  POST /analyze  (frames + platform + video URL + random install ID)
   ▼
Cloudflare Worker                          packages/worker
   │  shared verdict cache (KV, 30d): first viewer pays the Clef call,
   │  everyone after gets it free — the cost lever
   │  per-install daily quota (KV): 300 Clef-calling analyses/day, cache hits free
   ▼
Workers AI: @cf/cloudflare/clef-flash
   │  { answers, usage }
   ▼
decision: flag = 1 − P(organic) ≥ 0.80
   │
   ├─ pass ─► nothing happens, feed plays on
   └─ flag ─► pause + blurred overlay: [Resume] [Skip] [Got it wrong?]
                user report ──► fine-tuning dataset (R2) + verdict-cache invalidation
```

## Packages

| Package | What it is |
|---|---|
| `packages/engine` | Platform-agnostic core: frame extraction, Clef client (`analyze`), decision logic (`decide`). Unit-tested, no DOM-platform assumptions. |
| `packages/worker` | Cloudflare Worker: proxies frames to Clef, serves the shared verdict cache, enforces per-install quota, stores feedback reports in R2. |
| `packages/extension` | MV3 extension: platform adapters (all spike-verified against the live DOM), overlay, options page, debug/feedback panel. |
| `packages/testbed` | Local demo page + eval harness: runs a labeled video gallery headlessly and reports expected-vs-actual. |

`videos/` holds the (gitignored) labeled test gallery; `gallery.json` holds
its labels; `eval/` holds snapshot eval results.

## Quickstart

```sh
npm install          # workspaces install
npm test             # engine unit tests (decide, retry semantics, cache/quota wiring)
```

### Local demo + eval

```sh
npm run dev:worker   # terminal 1: wrangler dev → http://localhost:8787
npm run serve        # terminal 2: testbed page → http://localhost:8080
```

Drop MP4s into `videos/`, label them in `gallery.json`, then open the
testbed with `?eval=1` to run the whole gallery and get accuracy/latency
tables. Snapshot runs land in `eval/`. Tunables (frame fractions, canvas
size, threshold, the Clef questionnaire) all live in
`packages/engine/config.js` — version every change and correlate it with an
eval snapshot.

### Deploy your own Worker

The extension talks to a Worker with the AI binding, two KV namespaces, and
an R2 bucket:

```sh
cd packages/worker
npx wrangler kv namespace create VERDICTS    # put the printed id in wrangler.toml
npx wrangler kv namespace create QUOTA
npx wrangler r2 bucket create slop-feedback
npx wrangler secret put SLOP_TOKEN          # optional shared secret (X-Slop-Token)
npx wrangler deploy
```

The token is a casual-abuse filter, not security (it's extractable from the
extension). The real cost backstops are the per-install quota, the shared
verdict cache, and a Cloudflare rate-limiting rule on the Worker route —
set one in your Cloudflare dashboard (e.g. N requests/minute per IP).

### Extension from source

```sh
cd packages/extension
npm run build        # stage engine into vendor/ (or: npm run zip for a store build)
```

Then `chrome://extensions` → Developer mode → Load unpacked → select
`packages/extension`. If your Worker requires a token, either copy
`config.local.example.json` to `config.local.json` and paste the token, or
set it once on the options page (click the toolbar icon).

`npm run icons` regenerates the PNG set from `icons/icon.svg` (the
warning-sign mark).
`npm run zip` builds `dist/deslop-<version>.zip` for the Chrome Web
Store — it stages `vendor/` fresh and **refuses to build without a real
token in `config.local.json`** (a tokenless build would 401 against a
token-guarded Worker).

## Design decisions (the short version)

- **Warn-only, fail-open.** A classifier outage must never break playback.
- **Passive capture.** Frames are grabbed from live playback without
  seeking — the user's position in the feed is sacred.
- **Shared verdicts, not surveillance.** The cache stores verdicts *about
  video URLs*; the quota key is a random install UUID next to a counter.
  See [PRIVACY.md](PRIVACY.md) for the full data inventory.
- **Feedback is the dataset.** Wrong verdicts (both directions) are
  reportable from the overlay/debug panel; reports go to R2 and invalidate
  the cached verdict so the next viewer gets a fresh analysis.
- **Eval before tune.** Threshold/prompt changes are only made against
  measured eval results. See `PLAN.md` for the full decision log.

## License

MIT — see [LICENSE](LICENSE).
