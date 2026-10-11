const MAX_EVENTS = 500;

const ALLOWED_FIELDS = [
  'platform', 'jobId', 'stage', 'outcome', 'errorCode', 'skipOutcome',
  'captureMs', 'requestMs', 'totalMs', 'requestCount', 'cache', 'reason',
  'slopProb', 'authenticity', 'categoryChoice', 'categoryConfidence',
];

/**
 * Opt-in, memory-only diagnostics. The allowlist is intentional: diagnostics
 * must never retain URLs, page text, account data, or captured frames.
 */
export function createDiagnostics({ enabled = false, onEvent = () => {} } = {}) {
  const events = [];
  const analysis = [];

  function record(type, fields = {}) {
    if (!enabled) return null;
    const event = { at: new Date().toISOString(), type };
    for (const field of ALLOWED_FIELDS) {
      const value = fields[field];
      if (typeof value === 'number' || typeof value === 'string') event[field] = value;
    }
    events.push(event);
    if (events.length > MAX_EVENTS) events.shift();
    if (type === 'analysis.complete' && typeof event.totalMs === 'number') analysis.push(event);
    onEvent(event);
    return event;
  }

  function summary() {
    const values = analysis.map((event) => event.totalMs).sort((a, b) => a - b);
    const percentile = (fraction) => values.length
      ? values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))]
      : null;
    return {
      analysisCount: values.length,
      requestCount: events.filter((event) => event.type === 'request.start').length,
      p50TotalMs: percentile(0.5),
      p90TotalMs: percentile(0.9),
    };
  }

  function jobs() {
    const grouped = new Map();
    for (const event of events) {
      if (typeof event.jobId !== 'number') continue;
      if (!grouped.has(event.jobId)) grouped.set(event.jobId, []);
      grouped.get(event.jobId).push(event);
    }
    return [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([jobId, jobEvents]) => ({ jobId, events: jobEvents }));
  }

  return {
    enabled,
    record,
    summary,
    jobs,
    export() {
      return JSON.stringify({ version: 2, summary: summary(), jobs: jobs(), events }, null, 2);
    },
  };
}
