/**
 * Warning overlay: dark scrim over the player with the decision's "why"
 * and Resume / Skip actions. Mirrors the testbed design. One <style> tag
 * injected once; the overlay itself is a single DOM subtree.
 */

let stylesInjected = false;

/**
 * Platforms place transparent play/pause click-catchers over the video
 * (Instagram: [role="button"][aria-label="Press to play"]) and React apps
 * delegate events at the root. Events on our overlay must never reach them:
 * stopPropagation keeps clicks AND keystrokes (e.g. 'j' in the comment box
 * = next-reel shortcut) inside our subtree.
 */
const BLOCKED_EVENTS = [
  'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick',
  'touchstart', 'touchend', 'keydown', 'keyup', 'keypress',
];

function shieldEvents(element) {
  for (const type of BLOCKED_EVENTS) {
    element.addEventListener(type, (e) => e.stopPropagation());
  }
}

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = [
    '.slop-overlay { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 14px;',
    '  background: rgba(10,10,10,.72); backdrop-filter: blur(14px);',
    '  text-align: center; padding: 28px; font-family: system-ui, sans-serif; color: #eee; }',
    // in-host: absolute inside the platform's player container. Default —
    // correct on YouTube/TikTok (no transform stacking trap, follows the
    // player through fullscreen/theater/resizes for free).
    '.slop-overlay--host { position: absolute; inset: 0; z-index: 9999; }',
    // fixed-root: rendered at documentElement, rect-tracked via rAF. Required
    // only where the feed uses CSS transforms (Instagram), which trap z-index.
    '.slop-overlay--root { position: fixed; z-index: 2147483647; }',
    '.slop-overlay .slop-badge { font-size: 26px; font-weight: 800; color: #111; background: #ffcc4d;',
    '  width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }',
    '.slop-overlay .slop-title { font-size: 18px; font-weight: 700; }',
    '.slop-overlay .slop-row { display: flex; gap: 10px; }',
    '.slop-overlay button { border: 0; border-radius: 8px; padding: 10px 18px; font-size: 14px; cursor: pointer; }',
    '.slop-overlay .slop-resume { background: #4f8cff; color: #fff; }',
    '.slop-overlay .slop-skip { background: #2c2c2c; color: #eee; border: 1px solid #555; }',
    '.slop-overlay .slop-wrong { background: none; border: none; color: #777; font-size: 11px;',
    '  text-decoration: underline; cursor: pointer; padding: 2px; }',
    '.slop-overlay .slop-wrong:hover { color: #aaa; }',
    '.slop-overlay .slop-form { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 300px; }',
    '.slop-overlay .slop-form textarea { width: 100%; min-height: 64px; resize: vertical;',
    '  background: #1a1a1a; color: #eee; border: 1px solid #444; border-radius: 6px;',
    '  padding: 8px; font: 12px/1.4 system-ui, sans-serif; box-sizing: border-box; }',
    '.slop-overlay .slop-form .slop-send { background: #2c2c2c; color: #eee; border: 1px solid #555;',
    '  border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; align-self: flex-end; }',
    '.slop-overlay .slop-form .slop-send:disabled { opacity: .5; cursor: default; }',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * @param {HTMLElement} host   element the overlay covers (injection target
 *   for 'in-host', geometry reference for 'fixed-root')
 * @param {{onResume: () => void, onSkip: () => void, onReport?: (comment: string) => Promise<boolean>}} actions
 * @param {{strategy?: 'in-host' | 'fixed-root'}} [opts]  per-adapter render
 *   mode; adapters declare their overlayStrategy
 * @returns {{remove: () => void}}
 */
export function showOverlay(host, actions, { strategy = 'in-host' } = {}) {
  ensureStyles();

  const overlay = document.createElement('div');
  overlay.className = `slop-overlay slop-overlay--${strategy === 'fixed-root' ? 'root' : 'host'}`;
  shieldEvents(overlay);

  const badge = document.createElement('div');
  badge.className = 'slop-badge';
  badge.textContent = '!';

  const title = document.createElement('div');
  title.className = 'slop-title';
  title.textContent = 'Likely AI-generated slop';

  const row = document.createElement('div');
  row.className = 'slop-row';

  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'slop-resume';
  resumeBtn.textContent = 'Resume';
  resumeBtn.addEventListener('click', () => { remove(); actions.onResume(); });

  const skipBtn = document.createElement('button');
  skipBtn.className = 'slop-skip';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', () => { remove(); actions.onSkip(); });

  row.append(resumeBtn, skipBtn);
  overlay.append(badge, title, row);

  // Feedback: "this classification is wrong" — free-text correction that
  // becomes a fine-tuning dataset entry (frames + verdict + explanation).
  if (actions.onReport) {
    const wrongLink = document.createElement('button');
    wrongLink.className = 'slop-wrong';
    wrongLink.textContent = 'Got it wrong?';

    const form = document.createElement('div');
    form.className = 'slop-form';
    form.style.display = 'none';

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Why is this not AI slop?';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'slop-send';
    sendBtn.textContent = 'Send report';

    wrongLink.addEventListener('click', () => {
      wrongLink.style.display = 'none';
      form.style.display = 'flex';
      textarea.focus();
    });

    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = 'sending…';
      const ok = await actions.onReport(textarea.value.trim());
      sendBtn.textContent = ok ? 'reported ✓' : 'failed — retry';
      sendBtn.disabled = ok;
      if (ok) textarea.disabled = true;
    });

    form.append(textarea, sendBtn);
    overlay.append(wrongLink, form);
  }

  if (strategy === 'fixed-root') {
    // Render at the DOCUMENT ROOT with position:fixed, tracked to the host's
    // rect. Platform feeds that use CSS transforms (Instagram) create
    // stacking contexts that trap descendant z-index — an overlay appended
    // inside their DOM can never beat their click-catchers. At the root,
    // our z-index competes in the root stacking context and wins.
    document.documentElement.appendChild(overlay);

    let raf = 0;
    const syncRect = () => {
      const r = host.getBoundingClientRect();
      overlay.style.top = `${r.top}px`;
      overlay.style.left = `${r.left}px`;
      overlay.style.width = `${r.width}px`;
      overlay.style.height = `${r.height}px`;
      raf = requestAnimationFrame(syncRect);
    };
    syncRect();

    const remove = () => {
      cancelAnimationFrame(raf);
      overlay.remove();
    };
    return { remove };
  }

  // in-host (default): absolute inside the platform's player container.
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }
  host.appendChild(overlay);

  const remove = () => overlay.remove();
  return { remove };
}
