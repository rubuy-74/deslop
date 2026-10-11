import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisSession } from './analysis-session.js';

function fakeTimers() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimer(callback) {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    runAll() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
  };
}

const candidate = (overrides = {}) => ({
  adapter: {},
  routeKey: 'youtube-shorts:/shorts/one',
  video: {},
  key: 'blob:one',
  source: 'blob:one',
  ...overrides,
});

test('candidate must remain stable through the dwell before analysis starts', () => {
  const timers = fakeTimers();
  const stable = [];
  const session = createAnalysisSession({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onStable: (value) => stable.push(value),
  });

  const first = session.observe(candidate());
  session.observe(candidate({ key: 'blob:skipped', source: 'blob:skipped' }));
  timers.runAll();

  assert.equal(stable.length, 1);
  assert.equal(stable[0].key, 'blob:skipped');
  assert.equal(session.isCurrent(first), false);
});

test('same video element with a changed source creates a new generation', () => {
  const timers = fakeTimers();
  const video = {};
  const session = createAnalysisSession({ setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const first = session.observe(candidate({ video }));
  const second = session.observe(candidate({ video, key: 'blob:two', source: 'blob:two' }));

  assert.notEqual(first.generation, second.generation);
  assert.equal(session.isCurrent(first), false);
  assert.equal(session.isCurrent(second), true);
});

test('completed state is bounded and keeps the newest entries', () => {
  const session = createAnalysisSession({ cacheLimit: 2 });
  session.remember('one', 'passed');
  session.remember('two', 'flagged');
  session.remember('three', 'passed');

  assert.equal(session.completedSize, 2);
  assert.equal(session.completedState('one'), undefined);
  assert.equal(session.completedState('three'), 'passed');
});

test('invalidating a candidate cancels its dwell and reports the reason', () => {
  const timers = fakeTimers();
  const invalidated = [];
  const session = createAnalysisSession({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onInvalidate: (value, reason) => invalidated.push({ value, reason }),
  });

  const current = session.observe(candidate());
  session.invalidate('route-changed');
  timers.runAll();

  assert.equal(session.current, null);
  assert.equal(session.isCurrent(current), false);
  assert.equal(invalidated[0].reason, 'route-changed');
});

test('stable candidates report the measured dwell duration', () => {
  const timers = fakeTimers();
  let time = 100;
  let stable;
  const session = createAnalysisSession({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => time,
    onStable: (value) => { stable = value; },
  });

  session.observe(candidate());
  time = 537;
  timers.runAll();

  assert.equal(stable.dwellMs, 437);
});

test('changing dwell time reschedules a pending candidate without duplicating analysis', () => {
  const timers = fakeTimers();
  const stable = [];
  const session = createAnalysisSession({
    dwellMs: 400,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onStable: (value) => stable.push(value),
  });

  const current = session.observe(candidate());
  session.setDwellMs(700);
  timers.runAll();

  assert.equal(stable.length, 1);
  assert.equal(stable[0].generation, current.generation);
});
