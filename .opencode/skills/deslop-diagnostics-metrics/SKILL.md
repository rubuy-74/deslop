---
name: deslop-diagnostics-metrics
description: Maintain the deslop extension's privacy-safe diagnostics metrics contract and human-readable instrumentation. Use when adding, changing, reviewing, or exporting extension diagnostics, lifecycle timings, request counts, overlay outcomes, or parent issue #8 observability.
---

# Deslop Diagnostics Metrics

Use this skill whenever extension diagnostics are changed. Treat the metric
contract in [REFERENCE.md](REFERENCE.md) as the source of truth.

## Quick Start

1. Identify the lifecycle stage being measured.
2. Reuse the canonical event name and field semantics; do not invent synonyms.
3. Keep identifiers opaque and fields allowlisted.
4. Update the producer, grouped diagnostics/export shape, human-readable panel,
   tests, and `packages/extension/DIAGNOSTICS.md` together.
5. Run `npm test`, `npm run build -w packages/extension`, syntax checks, and
   `git diff --check`.

## Non-Negotiable Rules

- Diagnostics remain disabled by default and opt-in through the development
  setting.
- Diagnostics are memory-only unless the developer manually exports them.
- Never capture or export URLs, page text, account data, cookies, frames,
  titles, captions, or raw model/request errors.
- Use an opaque numeric `jobId` for one video analysis. Never use a video key or
  URL as a display or diagnostics identifier.
- Store safe error categories such as `timeout`, `quota exhausted`, or
  `worker unavailable`, not exception strings.
- Keep the event buffer bounded.
- Human-facing labels must explain the metric instead of exposing internal
  event names.

## Change Checklist

- [ ] Event name and timing boundary match the reference contract.
- [ ] New fields are added to the diagnostics allowlist.
- [ ] Request events include the owning `jobId`.
- [ ] The video card displays the metric in readable units and wording.
- [ ] Export and grouped job snapshots include the metric.
- [ ] Tests cover collection, grouping, privacy filtering, and formatting.
- [ ] Manual reproduction documentation explains how to observe it.
