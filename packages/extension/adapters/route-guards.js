const INSTAGRAM_REELS_PATH = /^\/reels?(?:\/|$)/i;
const TIKTOK_VIDEO_PATH = /^\/@[^/]+\/video\/[^/]+(?:\/|$)/i;
const TIKTOK_FOR_YOU_PATH = /^\/foryou(?:\/|$)/i;

export function isSupportedInstagramReelsContext(location) {
  return /(^|\.)instagram\.com$/i.test(location.hostname) && INSTAGRAM_REELS_PATH.test(location.pathname);
}

export function isSupportedTiktokFeedContext(location) {
  if (!/(^|\.)tiktok\.com$/i.test(location.hostname)) return false;
  return TIKTOK_FOR_YOU_PATH.test(location.pathname) || TIKTOK_VIDEO_PATH.test(location.pathname);
}
