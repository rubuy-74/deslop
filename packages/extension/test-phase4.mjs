import { InstagramReelsAdapter } from './adapters/instagram-reels.js';
import { showOverlay } from './overlay.js';
import { once, skipWithVerification } from './control-actions.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`ok   - ${name}`);
  else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}

function rect({ top = 0, left = 0, width = 100, height = 100 } = {}) {
  return { top, left, width, height, right: left + width, bottom: top + height };
}

function fakeEl({ r = rect(), connected = true, style = {}, parent = null, query = {} } = {}) {
  const el = {
    isConnected: connected,
    parentElement: parent,
    style: {},
    __style: style,
    _removed: false,
    _listeners: {},
    _children: [],
    getBoundingClientRect: () => r,
    querySelectorAll: (sel) => query[sel] ?? [],
    addEventListener(type, fn) {
      this._listeners[type] = fn;
    },
    append(...children) {
      this._children.push(...children);
      for (const child of children) child.parentElement = this;
    },
    appendChild(child) {
      this.append(child);
    },
    remove() {
      this._removed = true;
      if (this.parentElement?._children) {
        this.parentElement._children = this.parentElement._children.filter((c) => c !== this);
      }
    },
    click() {},
  };
  return el;
}

function withGlobals(setup, run) {
  const prev = {
    window: global.window,
    document: global.document,
    location: global.location,
    getComputedStyle: global.getComputedStyle,
    requestAnimationFrame: global.requestAnimationFrame,
    cancelAnimationFrame: global.cancelAnimationFrame,
  };
  Object.assign(global, setup);
  try {
    run();
  } finally {
    Object.assign(global, prev);
  }
}

/* --- candidate selection: connected+visible+related to active frame --- */
withGlobals(
  {
    window: { innerHeight: 800, innerWidth: 1200, scrollBy() {} },
    location: { href: 'https://www.instagram.com/reels/a', pathname: '/reels/a' },
  },
  () => {
    const body = fakeEl();
    const frame = fakeEl({ r: rect({ top: 80, left: 200, width: 320, height: 620 }), parent: body });
    const video = fakeEl({ r: rect({ top: 100, left: 220, width: 280, height: 560 }), parent: frame });
    video.paused = false;
    video.readyState = 4;
    const far = fakeEl({ r: rect({ top: 700, left: 1100, width: 60, height: 20 }) });
    const hidden = fakeEl({ style: { display: 'none' } });
    const good = fakeEl({ r: rect({ top: 330, left: 560, width: 48, height: 48 }) });
    const disconnected = fakeEl({ connected: false });
    for (const sel of ['[role="button"][aria-label*="next" i]', '[role="button"][aria-label*="down" i]', 'button[aria-label*="next" i]']) {
      frame.querySelectorAll = () => [hidden, disconnected];
      good.querySelectorAll = () => [];
      far.querySelectorAll = () => [];
    }
    global.document = {
      body,
      querySelectorAll: () => [far, good],
    };
    global.getComputedStyle = (el) => ({ display: el.__style.display ?? 'block', visibility: 'visible', pointerEvents: 'auto' });
    const picked = InstagramReelsAdapter.findNextControl(video);
    check('instagram next candidate picks related visible connected control', picked === good);
  }
);

/* --- failed advancement fallback resumes playback --- */
await (async () => {
  let plays = 0;
  const video = { isConnected: true, currentSrc: 'a', src: 'a', play: () => ({ catch() { plays++; } }) };
  const adapter = {
    next: () => true,
    videoKey: () => 'k1',
    findActiveVideo: () => video,
  };
  const advanced = await skipWithVerification(adapter, video, { timeoutMs: 10, pollMs: 2 });
  check('skip fallback returns false when active key/src never change', advanced === false);
  check('skip fallback resumes playback on failed advancement', plays === 1);
})();

/* --- stale host teardown + duplicate fixed-root prevention --- */
withGlobals(
  {
    location: { href: 'https://www.instagram.com/reels/a' },
  },
  () => {
    const head = fakeEl();
    const root = fakeEl();
    const body = fakeEl();
    let rafCb = null;
    let rafId = 0;
    global.document = {
      head,
      body,
      documentElement: root,
      createElement: () => fakeEl(),
    };
    global.getComputedStyle = () => ({ position: 'relative' });
    global.requestAnimationFrame = (cb) => {
      rafCb = cb;
      rafId += 1;
      return rafId;
    };
    global.cancelAnimationFrame = () => {};

    const hostA = fakeEl({ r: rect({ top: 10, left: 20, width: 30, height: 40 }) });
    const hostB = fakeEl({ r: rect({ top: 15, left: 25, width: 35, height: 45 }) });
    showOverlay(hostA, { onResume() {}, onSkip() {} }, { strategy: 'fixed-root' });
    const first = root._children.find((c) => c.className?.includes('slop-overlay--root'));
    check('fixed-root overlay initially mounted', !!first && !first._removed);
    showOverlay(hostB, { onResume() {}, onSkip() {} }, { strategy: 'fixed-root' });
    check('second fixed-root overlay removes duplicate previous one', first._removed === true);
    const second = root._children.find((c) => c.className?.includes('slop-overlay--root'));
    hostB.isConnected = false;
    rafCb?.();
    check('fixed-root overlay tears down when host disconnects', second._removed === true);
  }
);

/* --- repeated actions are idempotent --- */
{
  let n = 0;
  const fn = once(() => { n += 1; });
  fn();
  fn();
  fn();
  check('once wrapper makes repeated action idempotent', n === 1);
}

console.log(failures === 0 ? '\nall tests passed' : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
