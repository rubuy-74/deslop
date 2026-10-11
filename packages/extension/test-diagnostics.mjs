import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagnostics } from './diagnostics.js';

test('diagnostics are disabled by default and collect nothing', () => {
  const diagnostics = createDiagnostics();
  diagnostics.record('request.start', { platform: 'instagram-reels', requestCount: 1 });
  assert.deepEqual(diagnostics.summary(), {
    analysisCount: 0,
    requestCount: 0,
    p50TotalMs: null,
    p90TotalMs: null,
  });
  assert.equal(diagnostics.export(), JSON.stringify({ version: 2, summary: diagnostics.summary(), jobs: [], events: [] }, null, 2));
});

test('diagnostics allowlist excludes sensitive fields and computes latency', () => {
  const diagnostics = createDiagnostics({ enabled: true });
  diagnostics.record('request.start', { platform: 'instagram-reels', jobId: 1, videoUrl: 'https://instagram.com/reel/private', requestCount: 1 });
  diagnostics.record('analysis.complete', { platform: 'instagram-reels', jobId: 1, totalMs: 100 });
  diagnostics.record('analysis.complete', { platform: 'instagram-reels', jobId: 2, totalMs: 300 });

  const output = JSON.parse(diagnostics.export());
  assert.deepEqual(output.summary, { analysisCount: 2, requestCount: 1, p50TotalMs: 100, p90TotalMs: 300 });
  assert.equal(JSON.stringify(output).includes('private'), false);
  assert.equal(output.events[0].videoUrl, undefined);
  assert.deepEqual(diagnostics.jobs(), [{ jobId: 1, events: [output.events[0], output.events[1]] }, { jobId: 2, events: [output.events[2]] }]);
});
