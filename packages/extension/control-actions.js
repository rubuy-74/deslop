function videoIdentity(adapter, video) {
  if (!video) return { key: null, src: null };
  return {
    key: adapter.videoKey?.(video) ?? null,
    src: video.currentSrc ?? video.src ?? null,
  };
}

function changedIdentity(before, after) {
  return (
    (!!before.key && !!after.key && before.key !== after.key) ||
    (!!before.src && !!after.src && before.src !== after.src)
  );
}

export function resumePlayback(adapter, preferredVideo) {
  const video = preferredVideo?.isConnected ? preferredVideo : adapter.findActiveVideo?.();
  video?.play?.().catch?.(() => {});
}

export async function skipWithVerification(adapter, video, { timeoutMs = 1200, pollMs = 120 } = {}) {
  const before = videoIdentity(adapter, video ?? adapter.findActiveVideo?.());
  const requested = !!adapter.next?.(video);
  if (!requested) {
    resumePlayback(adapter, video);
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const active = adapter.findActiveVideo?.();
    if (changedIdentity(before, videoIdentity(adapter, active))) return true;
  }
  resumePlayback(adapter, video);
  return false;
}

export function once(fn) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}
