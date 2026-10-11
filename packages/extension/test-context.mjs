import assert from 'node:assert/strict';
import test from 'node:test';
import { InstagramReelsAdapter, isUsableNextControl } from './adapters/instagram-reels.js';
import { TiktokAdapter } from './adapters/tiktok.js';
import { YoutubeShortsAdapter } from './adapters/youtube-shorts.js';

const page = (url) => new URL(url);

test('YouTube supports Shorts routes only', () => {
  assert.equal(YoutubeShortsAdapter.matches(page('https://www.youtube.com/shorts/abc')), true);
  assert.equal(YoutubeShortsAdapter.supportsContext(page('https://www.youtube.com/shorts/abc')), true);
  assert.equal(YoutubeShortsAdapter.supportsContext(page('https://www.youtube.com/watch?v=abc')), false);
  assert.equal(YoutubeShortsAdapter.supportsContext(page('https://www.youtube.com/')), false);
});

test('TikTok supports the root or explicit For You feed only', () => {
  assert.equal(TiktokAdapter.matches(page('https://www.tiktok.com/foryou')), true);
  assert.equal(TiktokAdapter.supportsContext(page('https://www.tiktok.com/')), true);
  assert.equal(TiktokAdapter.supportsContext(page('https://www.tiktok.com/foryou')), true);
  assert.equal(TiktokAdapter.supportsContext(page('https://www.tiktok.com/foryou/')), true);
  assert.equal(TiktokAdapter.supportsContext(page('https://www.tiktok.com/search?q=ai')), false);
  assert.equal(TiktokAdapter.supportsContext(page('https://www.tiktok.com/@user')), false);
});

test('Instagram supports the dedicated Reels feed only', () => {
  assert.equal(InstagramReelsAdapter.matches(page('https://www.instagram.com/reels/')), true);
  assert.equal(InstagramReelsAdapter.supportsContext(page('https://www.instagram.com/reels/')), true);
  assert.equal(InstagramReelsAdapter.supportsContext(page('https://www.instagram.com/reels/abc')), true);
  assert.equal(InstagramReelsAdapter.supportsContext(page('https://www.instagram.com/username/')), false);
  assert.equal(InstagramReelsAdapter.supportsContext(page('https://www.instagram.com/stories/username')), false);
  assert.equal(InstagramReelsAdapter.supportsContext(page('https://www.instagram.com/reel/abc')), false);
});

test('Instagram next controls must be connected, visible, and enabled', () => {
  const base = {
    isConnected: true,
    disabled: false,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 40, height: 40 }),
  };

  assert.equal(isUsableNextControl(base), true);
  assert.equal(isUsableNextControl({ ...base, isConnected: false }), false);
  assert.equal(isUsableNextControl({ ...base, disabled: true }), false);
  assert.equal(isUsableNextControl({ ...base, getAttribute: () => 'true' }), false);
  assert.equal(isUsableNextControl({ ...base, getBoundingClientRect: () => ({ width: 0, height: 40 }) }), false);
});

test('Instagram Skip uses a visible global next control and verifies advancement', async () => {
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  const location = { pathname: '/reels/one/', href: 'https://www.instagram.com/reels/one/' };
  const video = { currentSrc: 'blob:one', src: 'blob:one' };
  const button = {
    isConnected: true,
    disabled: false,
    getAttribute: (name) => name === 'aria-disabled' ? null : 'Navigate to next Reel',
    getBoundingClientRect: () => ({ width: 40, height: 40 }),
    click: () => {
      location.href = 'https://www.instagram.com/reels/two/';
      video.currentSrc = 'blob:two';
      video.src = 'blob:two';
    },
  };
  globalThis.location = location;
  globalThis.document = { querySelectorAll: () => [button] };

  try {
    const result = await InstagramReelsAdapter.next.call({
      ...InstagramReelsAdapter,
      findActiveVideo: () => video,
    });
    assert.equal(result, 'advanced');
  } finally {
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
  }
});
