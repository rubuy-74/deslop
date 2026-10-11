import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePassiveFrames } from './engine.js';

test('passive capture aborts between frames without capturing later frames', async () => {
  let draws = 0;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        drawImage() { draws += 1; },
      }),
      toBlob(callback, type) {
        setTimeout(() => callback(new Blob(['frame'], { type })), 0);
      },
    }),
  };
  const video = { readyState: 2, videoWidth: 360, videoHeight: 640 };
  const controller = new AbortController();
  const capture = capturePassiveFrames(video, { count: 3, intervalMs: 30, signal: controller.signal });
  setTimeout(() => controller.abort(), 5);

  await assert.rejects(capture, (error) => error.name === 'AbortError');
  assert.equal(draws, 1);
});
