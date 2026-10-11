const DIAG_PREFIX = '[deslop:diag]';

function safeNumber(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

export function classifyVideoIdentity(value) {
  if (typeof value !== 'string' || !value) return { kind: 'missing' };
  if (value.startsWith('blob:')) return { kind: 'blob' };
  try {
    const u = new URL(value);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.includes('youtube.com') && parts[0] === 'shorts' && parts[1]) {
      return { kind: 'youtube-short', id: parts[1].slice(0, 24) };
    }
    if (u.hostname.includes('tiktok.com')) {
      const videoIdx = parts.indexOf('video');
      if (videoIdx !== -1 && parts[videoIdx + 1]) {
        return { kind: 'tiktok-video', id: parts[videoIdx + 1].slice(0, 24) };
      }
    }
    if (u.hostname.includes('instagram.com') && /^reels?$/.test(parts[0] ?? '') && parts[1]) {
      return { kind: 'instagram-reel', id: parts[1].slice(0, 24) };
    }
    return { kind: 'url', host: u.hostname, pathShape: parts.slice(0, 2).join('/') || '/' };
  } catch {
    return { kind: 'opaque', length: value.length };
  }
}

export function describeElementIdentity(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect?.();
  return {
    tag: element.tagName?.toLowerCase?.() ?? null,
    role: element.getAttribute?.('role') ?? null,
    width: safeNumber(rect?.width),
    height: safeNumber(rect?.height),
  };
}

export function createDiagnostics(enabled) {
  const isEnabled = enabled === true;
  function log(event, payload = {}) {
    if (!isEnabled) return;
    console.info(DIAG_PREFIX, {
      ts: new Date().toISOString(),
      event,
      ...payload,
    });
  }
  return { enabled: isEnabled, log };
}
