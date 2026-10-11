import assert from 'node:assert/strict';
import test from 'node:test';
import { activateExistingTabs, isSupportedTabUrl, shouldActivateExistingTabs } from './lifecycle.js';
import { startOnce } from './content-bootstrap.js';

test('install and update are the only lifecycle events that activate existing tabs', () => {
  assert.equal(shouldActivateExistingTabs('install'), true);
  assert.equal(shouldActivateExistingTabs('update'), true);
  assert.equal(shouldActivateExistingTabs('chrome_update'), false);
  assert.equal(shouldActivateExistingTabs('shared_module_update'), false);
});

test('existing-tab activation recognizes only supported feed URLs', () => {
  const supported = [
    'https://www.youtube.com/shorts/abc',
    'https://youtube.com/shorts?feature=share',
    'https://www.tiktok.com/',
    'https://www.tiktok.com/foryou/',
    'https://www.instagram.com/reels/abc',
  ];
  const unsupported = [
    'https://www.youtube.com/watch?v=abc',
    'https://www.tiktok.com/search?q=ai',
    'https://www.tiktok.com/@creator',
    'https://www.instagram.com/username/',
    'https://www.instagram.com/stories/username',
    'https://m.youtube.com/shorts/abc',
    'chrome://extensions',
    'not a URL',
  ];

  for (const url of supported) assert.equal(isSupportedTabUrl(url), true, url);
  for (const url of unsupported) assert.equal(isSupportedTabUrl(url), false, url);
});

test('activation injects supported tabs once and ignores unsupported tabs', async () => {
  const injected = [];
  const results = await activateExistingTabs({
    queryTabs: async () => [
      { id: 1, url: 'https://www.youtube.com/shorts/abc' },
      { id: 2, url: 'https://www.tiktok.com/search?q=ai' },
      { id: 3, url: 'https://www.instagram.com/reels/' },
      { id: undefined, url: 'https://www.instagram.com/reels/abc' },
    ],
    inject: async (tabId) => injected.push(tabId),
  });

  assert.deepEqual(injected, [1, 3]);
  assert.equal(results.length, 2);
});

test('content bootstrap starts once for concurrent executions', async () => {
  const scope = {};
  let starts = 0;
  const start = async () => {
    starts += 1;
  };

  await Promise.all([startOnce(scope, start), startOnce(scope, start)]);

  assert.equal(starts, 1);
});

test('content bootstrap can retry after a failed start', async () => {
  const scope = {};
  let starts = 0;
  const fail = startOnce(scope, async () => {
    starts += 1;
    throw new Error('bootstrap failed');
  });

  await assert.rejects(fail, /bootstrap failed/);
  await startOnce(scope, async () => {
    starts += 1;
  });

  assert.equal(starts, 2);
});
