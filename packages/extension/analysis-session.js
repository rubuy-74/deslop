const DEFAULT_DWELL_MS = 1000;
const DEFAULT_CACHE_LIMIT = 128;

function sameCandidate(a, b) {
  return a
    && b
    && a.adapter === b.adapter
    && a.routeKey === b.routeKey
    && a.video === b.video
    && a.key === b.key
    && a.source === b.source;
}

/**
 * Coordinates the one candidate that may be analyzed at a time. The caller
 * remains responsible for validating live DOM identity before applying work.
 */
export function createAnalysisSession({
  dwellMs = DEFAULT_DWELL_MS,
  cacheLimit = DEFAULT_CACHE_LIMIT,
  onStable = () => {},
  onInvalidate = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => performance.now(),
} = {}) {
  let current = null;
  let timer = null;
  let nextGeneration = 0;
  let currentDwellMs = dwellMs;
  const completed = new Map();

  function scheduleStable(session) {
    timer = setTimer(() => {
      timer = null;
      if (current?.generation !== session.generation || session.stable) return;
      session.stable = true;
      session.dwellMs = Math.round(now() - session.candidateStartedAt);
      onStable(session);
    }, Math.max(0, currentDwellMs - (now() - session.candidateStartedAt)));
  }

  function invalidate(reason = 'candidate-changed') {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!current) return;
    const previous = current;
    current = null;
    onInvalidate(previous, reason);
  }

  function observe(candidate) {
    if (sameCandidate(current, candidate)) return current;

    invalidate('candidate-changed');
    if (!candidate) return null;

    const session = { ...candidate, generation: ++nextGeneration, candidateStartedAt: now() };
    current = session;
    scheduleStable(session);
    return session;
  }

  function setDwellMs(value) {
    if (!Number.isFinite(value) || value < 0) return currentDwellMs;
    currentDwellMs = Math.round(value);
    if (current && !current.stable) {
      if (timer !== null) clearTimer(timer);
      scheduleStable(current);
    }
    return currentDwellMs;
  }

  function isCurrent(session) {
    return current?.generation === session?.generation;
  }

  function remember(key, state) {
    if (!key) return;
    completed.delete(key);
    completed.set(key, state);
    while (completed.size > cacheLimit) completed.delete(completed.keys().next().value);
  }

  function completedState(key) {
    return completed.get(key);
  }

  return {
    observe,
    setDwellMs,
    invalidate,
    isCurrent,
    remember,
    completedState,
    get current() {
      return current;
    },
    get completedSize() {
      return completed.size;
    },
  };
}
