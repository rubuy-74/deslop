# Anti-Slop Decision Engine — Part 1 Plan

## 1. Goal & Scope

Build the **engine + testbed** for detecting AI slop in short-form video:

- A **local demo page** (HTML5 video) that plays a labeled gallery of test videos.
- A **platform-agnostic JS engine module** (frame extraction → Clef call → decision) that can later be lifted into a browser extension (Part 2).
- A **Cloudflare Worker** that proxies frames to Clef (`@cf/cloudflare/clef-flash` by default).
- An **eval mode** in the demo page that runs the whole labeled gallery and reports expected-vs-actual, so prompt/threshold changes are measurable.

**Explicit non-goals (Part 2+):** platform integration (extension, SPA quirks), AUTO_SKIP tier (gated on measured precision), fine-tuning (gated on prompt-engineering ceiling, proven via eval), deployment beyond localhost.

## 2. Decisions Locked During Design

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | Deliverable | Local demo page; engine written as standalone JS module |
| 2 | Validation | Labeled gallery (15–30 MP4s) as a *test suite* for prompt/threshold iteration — NOT training/fine-tuning data |
| 3 | Sourcing | Mixed: CC0 stock (Pexels/Pixabay) for organic near-misses; real slop saved from own feeds (local-only, gitignored); self-generated clips to fill category gaps. Only `gallery.json` labels are committed |
| 4 | Sampling | 4 frames at `[0.10, 0.40, 0.70, 0.95] × min(duration, 2s)` — proportional, 2s cap, no duplicate frames on short videos |
| 5 | Geometry | Letterbox into 360×640 canvas (scale-to-fit + black bars), WebP q0.75 (JPEG fallback if WebP encode unsupported) |
| 6 | Model | `clef-flash` default; Worker accepts `model` override so eval mode can compare flash vs full clef on the same gallery |
| 7 | Actions | **Warn-only**. Every flag → overlay with [Resume]/[Skip]. Fail-OPEN on Clef error/timeout (video plays, failure logged). Threshold starts at 0.80, tuned via eval |
| 8 | Schema | Multiple-choice question is PRIMARY: `flag = (1 − P(organic)) ≥ 0.80`; 5 boxes incl. `other_ai` catch-all; yes/no noul kept as logged second opinion (disagreement = taxonomy-hole detector); 0–3 authenticity score shown on warning |
| 9 | UX | Hold video at first frame during analysis → play normally or show blurred-scrim warning with reason, confidence, authenticity. No spinner. Eval mode bypasses overlay |

## 3. Corrections to the Original Spec (verified against API schemas)

1. **Image encoding**: Clef accepts images only as base64 — a `data:image/webp;base64,...` string or `{content_type, base64}` object. `[...new Uint8Array(buf)]` (number arrays) is **invalid**. Max 4 images, 16 MP each, WebP accepted — our design complies.
2. **Response shape**: results live under `answers.<question_id>`:
   - noul → `{ type: "noul", noul: number }` (no `.value`/`.probability`; `noul` IS the yes-probability)
   - choice → `{ type: "choice", choice, probabilities, confidence }` (probabilities sum to 1)
   - score → `{ type: "score", score, legend, probabilities, confidence }` (score is probability-weighted, can land between levels, 0-indexed)
   - Plus `usage.input_tokens` — log this for cost visibility.
3. **Latency targets**: the published 39ms median for clef-flash is text-only; image latency is unknown. Acceptance criteria become **measure-baseline-first, then set targets** (see §7).

## 4. Architecture

```
[ Demo Page (static HTML/JS) ]
   gallery.json ──► video element (held at t=0, muted)
        │ engine.js
        │  1. wait loadedmetadata
        │  2. 4× (seek + letterbox draw + toBlob webp/q0.75)
        │  3. POST multipart/form-data ──────────► [ Cloudflare Worker ]
        │                                              │ frames → base64
        │                                              ▼
        │                                     env.AI.run('@cf/cloudflare/clef-flash',
        │                                       { model, state, images, questions })
        │                                              ▼
        │                                     { answers, usage }
        │  4. decision.js: flag = 1−P(organic) ≥ T
        ▼
   play video  OR  blurred-scrim overlay [Resume]/[Skip]
```

Repo layout:

```
slop_rotting/
├── PLAN.md
├── worker/
│   ├── wrangler.toml        # ai binding, compatibility_date
│   └── src/index.ts         # POST /analyze (multipart), ?model= override, CORS *
├── web/
│   ├── index.html           # gallery list + player + overlay + eval table
│   ├── engine.js            # extractFrames(), analyze(), decide() — platform-agnostic
│   ├── app.js               # demo page wiring (hold/play/overlay/skip)
│   └── config.js            # ALL tunables: timestamps, geometry, threshold, schema, state text
├── videos/                  # GITIGNORED test MP4s
└── gallery.json             # [{ file, expectFlag, expectCategory, notes }]
```

## 5. Clef Questionnaire (config.js, versioned)

```js
export const CLEF_CONFIG = {
  model: 'clef-flash',                 // overridable via ?model=clef
  threshold: 0.80,                     // flag when 1 − P(organic) ≥ threshold
  state: 'Four chronological frames sampled across the first 2 seconds ' +
         'of a short-form mobile video. Judge the visual content.',
  questions: {
    slop_category: {                   // PRIMARY signal
      type: 'choice',
      instructions: 'Which category best describes this video? Judge by visual signatures, not topic.',
      criteria: {
        organic: 'Real camera footage, human-made animation, gameplay, or standard creator content with natural optics and motion',
        absurdist_ai: 'Synthetic rendering artifacts (plastic textures, impossible physics/speculars, distorted micro-details); e.g. anthropomorphic objects or foods acting out dramas',
        synthetic_parody: 'Real public-figure faces on incongruous bodies; facial boundary artifacts, frozen gaze, ear/jaw blending between frames',
        static_ai_slideshow: 'Sequence of static generative illustrations, no organic camera motion, oversized auto-captions',
        other_ai: 'AI-generated/synthetic content not matching the above; smeared or hallucinated detail, generative artifacts of any kind'
      }
    },
    is_slop: {                         // SECOND OPINION (logged, not gated on)
      type: 'noul',
      instructions: 'Is this video AI-generated slop or low-effort synthetic content?',
      criteria: {
        true: 'Any synthetic generation, face-swap, or automated slideshow content',
        false: 'Genuinely filmed or human-crafted content, even if filtered or edited'
      }
    },
    visual_authenticity: {             // DISPLAY on warning overlay
      type: 'score',
      instructions: 'Rate organic visual authenticity.',
      criteria: [
        'Pure synthetic generation: plastic skin, uncanny blending, hallucinated limbs',
        'Heavy AI augmentation with obvious artifacts',
        'Ambiguous or heavily filtered authentic footage',
        'Verifiable organic photography, consistent real-world optics'
      ]
    }
  }
};
```

Decision logic (`decide(answers)`):

```js
const p = answers.slop_category.probabilities;
const slopProb = 1 - (p.organic ?? 0);
const flag = slopProb >= config.threshold;
const reason = topNonOrganic(p);              // category with max prob among non-organic
const crossCheck = answers.is_slop.noul;      // log |crossCheck≥0.5| vs flag disagreements
const authenticity = answers.visual_authenticity.score;
return { flag, reason, slopProb, crossCheck, authenticity };
```

## 6. Build Steps

1. **Worker scaffold**: `wrangler.toml` (AI binding), `src/index.ts` — POST-only, parse up to 4 multipart frames, base64-encode, call Clef with `?model=` passthrough, return raw `answers` + `usage`, CORS `*`, 400 on no frames.
2. **Engine module** (`web/engine.js`):
   - `extractFrames(video)`: wait `loadedmetadata`; for each `t` in `[0.10,0.40,0.70,0.95]×min(duration,2s)`: seek (with 1s `seeked` timeout), letterbox-draw into 360×640, `toBlob('image/webp', 0.75)` with JPEG fallback; restore original `currentTime`; mute; total-extraction timeout.
   - `analyze(blobs, model)`: multipart POST to worker; 3s fetch timeout; on error/timeout → `{ flag: false, error }` (**fail open**, logged).
   - `decide(answers)`: per §5.
3. **Demo page** (`web/index.html` + `app.js`): gallery sidebar from `gallery.json`; on select, load video muted+held → run engine → play or show overlay. Overlay: `backdrop-filter` blur + dark scrim, text `Likely AI-generated: <reason label> — <slopProb%> confident, authenticity <score>/3`, buttons [Resume] (unpause, hide) / [Skip] (next gallery video).
4. **Eval mode** (`?eval=1`): iterate all gallery entries headlessly; table of expected vs actual flag, category probabilities, `is_slop` cross-check disagreements, per-video latency (extract / clef / total), token usage; summary tallies (flag accuracy, per-category misses); button to re-run with `?model=clef` for comparison.
5. **Gallery curation (user task)**: 15–30 MP4s into gitignored `videos/`; fill `gallery.json` with `expectFlag`/`expectCategory` — include organic near-misses (real fruit art, cosplay, animation, heavy filters) and slop across all 3 categories + ideally one "weird" slop specimen to exercise `other_ai`.
6. **Baseline + tune**: run eval; record measured baselines (extract ms, clef ms flash vs clef, payload KB); tune `threshold` and schema wording only against eval improvements; snapshot results per config change.

## 7. Acceptance Criteria (revised)

| Metric | Target | Notes |
|---|---|---|
| Eval baseline documented | required | First eval run's accuracy + latencies committed as `eval/baseline.md` |
| Flag accuracy on gallery | measure, then set | No arbitrary number before data; false positives on organic near-misses are the key watch-item |
| Payload size | ≤ 80 KB typical (4× WebP 360×640) | Hard ceiling 8 MiB decoded — unreachable at our size |
| Extract / Clef / total latency | measure baseline, then set | Original 120/60/350ms guesses replaced by measured values; clef-flash vs clef comparison recorded |
| Determinism check | 3 identical runs → same decisions | Validates the eval suite's reliability as a regression test |

## 8. Risks & Open Items

- **Image latency unknown**: if clef-flash + 4 images is far above the text-only 39ms median, the hold-then-warn UX still works (a few hundred ms held on frame 0 is acceptable); eval will quantify it.
- **Safari**: `canvas.toBlob('image/webp')` unsupported → JPEG fallback path.
- **Determinism**: assumed stable per Clef's design; verified by the 3-run check before trusting eval as regression suite.
- **Gallery bias**: self-curated labels are ground truth by construction; keep notes on borderline videos in `gallery.json`.
- **Cost**: negligible at dev volume ($0.09/M input tokens); `usage` logged in eval mode for visibility.
