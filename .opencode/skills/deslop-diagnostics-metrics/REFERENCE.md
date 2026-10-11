# Diagnostics Metric Contract

This contract applies to `packages/extension/content.js`,
`packages/extension/diagnostics.js`, and `packages/extension/debug-panel.js`.

## Identity

`jobId` is a monotonically increasing opaque number scoped to the content
script. It identifies one attempted analysis of one active video. It must not be
derived from a URL, source, DOM text, or account data.

## Canonical Events

| Event | Meaning | Required fields |
|---|---|---|
| `analysis.start` | A stable active video entered analysis | `platform`, `jobId` |
| `capture.complete` | Passive frame capture finished | `platform`, `jobId`, `captureMs` |
| `request.start` | Content script sent an analysis message | `platform`, `jobId`, `requestCount` |
| `request.complete` | Content script received a response or timeout | `platform`, `jobId`, `outcome`, `requestMs`, `requestCount` |
| `analysis.complete` | The full content-side analysis pipeline finished | `platform`, `jobId`, `outcome`, `totalMs` |
| `decision.apply` | The decision was applied, passed, or became stale | `platform`, `jobId`, `outcome` |
| `overlay.show` | A warning overlay was displayed | `platform`, `jobId` |
| `overlay.resume` | The user resumed a flagged video | `platform`, `jobId` |
| `overlay.skip` | The user activated Skip | `platform`, `jobId`, `skipOutcome` |

Internal events can be retained for export, but the panel should show only
measurable, user-understandable stages. Do not show `analysis.start`,
`decision.apply`, or `overlay.show` as timing rows.

## Timing Semantics

- `captureMs`: elapsed time inside `capturePassiveFrames`, including the waits
  between passive frame captures and frame encoding.
- `requestMs`: elapsed time from the content script's analysis message until
  its callback returns. This is the content-to-extension-worker round trip; it
  includes worker/network/model time and any engine retry, but is not a direct
  server-only duration.
- `totalMs`: elapsed time from `analysis.start` until `analysis.complete`.
  It includes capture, request round trip, response/decision handling, and
  small local overhead. It should be approximately `captureMs + requestMs`.
- `requestCount`: number of content-script analysis messages sent for the job.
  It is normally `1`; it is not the number of internal `fetch()` retries in the
  engine unless that is explicitly instrumented in the future.

Display durations in seconds for values of one second or more, otherwise in
milliseconds. Use labels such as `Total elapsed`, `Frame capture`, `Worker
round-trip`, and `Worker messages`.

## Decision Fields

When available, `analysis.complete` may include:

- `categoryChoice`: model-selected type, using the configured category keys.
- `categoryConfidence`: model confidence for the selected type, displayed as
  a percentage.
- `slopProb`: probability that content is non-organic.
- `authenticity`: model authenticity score.
- `cache`: `hit`, `miss`, `skip`, or `none`.
- `reason`: safe configured category key only.

Map category keys to readable labels in the panel. Never display raw model
responses or arbitrary model-generated text.

## Privacy and Export

The diagnostics allowlist is authoritative. New fields require an explicit
review for privacy. Exported data is versioned and must include grouped jobs so
one video's lifecycle can be inspected without reconstructing it from an
unrelated global event stream.

## Parent Issue Coverage

These metrics support diagnosis, not automatic proof, for parent issue #8:

- #9: lifecycle, timing, request count, and overlay diagnostics.
- #10: request counts can verify zero requests only when route/context outcome
  instrumentation is also present.
- #11: stale decisions and latency are visible; dwell/cancellation and active
  element transitions need dedicated events.
- #12: tab activation needs service-worker activation events.
- #13: Resume/Skip outcomes are visible; playback/feed advancement still needs
  live verification.
- #14/#15: automated regression tests and live matrix runs remain separate
  deliverables.
