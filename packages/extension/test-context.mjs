import assert from 'node:assert/strict';
import test from 'node:test';
import { InstagramReelsAdapter } from './adapters/instagram-reels.js';
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
