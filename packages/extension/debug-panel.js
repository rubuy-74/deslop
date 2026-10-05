/**
 * Debug panel: fixed bottom-right overlay for development sessions.
 * Shows worker connection status and a live log of engine events
 * (analyzing / pass / flag / error) so behavior is visible without
 * opening devtools. Collapsible; click the header to toggle.
 */

let stylesInjected = false;

/** Same rationale as overlay.js: our UI must not leak events to the player. */
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
    '.slop-debug { position: fixed; right: 12px; bottom: 12px; z-index: 10000; width: 340px;',
    '  background: rgba(16,16,16,.92); border: 1px solid #333; border-radius: 8px;',
    '  font: 11px/1.45 ui-monospace, monospace; color: #ccc; }',
    '.slop-debug .sd-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px;',
    '  cursor: pointer; user-select: none; border-bottom: 1px solid #2a2a2a; }',
    '.slop-debug .sd-dot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex: none; }',
    '.slop-debug .sd-dot.ok { background: #3fb950; } .slop-debug .sd-dot.bad { background: #f85149; }',
    '.slop-debug .sd-title { font-weight: 700; color: #eee; }',
    '.slop-debug .sd-platform { color: #888; }',
    '.slop-debug .sd-ping { margin-left: auto; background: #2c2c2c; color: #ddd; border: 1px solid #444;',
    '  border-radius: 4px; padding: 2px 8px; font: inherit; cursor: pointer; }',
    '.slop-debug .sd-report { background: #2c2c2c; color: #f85149; border: 1px solid #444;',
    '  border-radius: 4px; padding: 2px 8px; font: inherit; cursor: pointer; }',
    '.slop-debug .sd-form { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;',
    '  border-bottom: 1px solid #2a2a2a; }',
    '.slop-debug .sd-form textarea { width: 100%; min-height: 48px; resize: vertical; box-sizing: border-box;',
    '  background: #1a1a1a; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 6px; font: inherit; }',
    '.slop-debug .sd-form .sd-send { align-self: flex-end; background: #2c2c2c; color: #eee;',
    '  border: 1px solid #555; border-radius: 4px; padding: 3px 10px; font: inherit; cursor: pointer; }',
    '.slop-debug .sd-form .sd-send:disabled { opacity: .5; cursor: default; }',
    '.slop-debug .sd-body { max-height: 220px; overflow-y: auto; padding: 4px 0; }',
    '.slop-debug.collapsed .sd-body { display: none; }',
    '.slop-debug .sd-row { display: flex; gap: 6px; padding: 2px 10px; border-top: 1px solid #1f1f1f; }',
    '.slop-debug .sd-time { color: #666; flex: none; }',
    '.slop-debug .sd-key { color: #79b8ff; flex: none; max-width: 90px; overflow: hidden;',
    '  text-overflow: ellipsis; white-space: nowrap; }',
    '.slop-debug .sd-verdict { flex: none; font-weight: 700; }',
    '.slop-debug .sd-verdict.flag { color: #f85149; } .slop-debug .sd-verdict.pass { color: #3fb950; }',
    '.slop-debug .sd-verdict.err { color: #d29922; } .slop-debug .sd-verdict.analyzing { color: #888; }',
    '.slop-debug .sd-extra { color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  ].join('\n');
  document.head.appendChild(style);
}

function shortKey(key) {
  if (!key) return '?';
  const m = /shorts\/([^/?#]+)/.exec(key);
  if (m) return m[1];
  try {
    const u = new URL(key);
    return (u.searchParams.get('v') ?? u.pathname).slice(-11);
  } catch {
    return String(key).slice(-11);
  }
}

export function initDebugPanel(hooks = {}) {
  ensureStyles();

  const root = document.createElement('div');
  root.className = 'slop-debug collapsed';
  shieldEvents(root);

  const head = document.createElement('div');
  head.className = 'sd-head';
  const dot = document.createElement('span');
  dot.className = 'sd-dot';
  const title = document.createElement('span');
  title.className = 'sd-title';
  const version = chrome.runtime.getManifest?.().version ?? '?';
  title.textContent = `slop debug v${version}`;
  const platformEl = document.createElement('span');
  platformEl.className = 'sd-platform';
  platformEl.textContent = '· …';

  const pingBtn = document.createElement('button');
  pingBtn.className = 'sd-ping';
  pingBtn.textContent = 'ping';

  head.append(dot, title, platformEl);
  // False-negative feedback: report the currently playing video as slop.
  if (hooks.onReportSlop) {
    const reportBtn = document.createElement('button');
    reportBtn.className = 'sd-report';
    reportBtn.textContent = 'report slop';
    reportBtn.title = 'Mark the current video as slop (wrongly passed)';
    reportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
      root.classList.remove('collapsed');
      textarea.focus();
    });
    head.append(reportBtn);
  }
  head.append(pingBtn);

  const body = document.createElement('div');
  body.className = 'sd-body';

  // Inline report form (hidden until "report slop" is clicked).
  const form = document.createElement('div');
  form.className = 'sd-form';
  form.style.display = 'none';
  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Why is this AI slop? (optional context)';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'sd-send';
  sendBtn.textContent = 'capture + send';
  form.append(textarea, sendBtn);

  sendBtn.addEventListener('click', async () => {
    if (!hooks.onReportSlop) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'capturing…';
    try {
      const res = await hooks.onReportSlop(textarea.value.trim());
      sendBtn.textContent = res?.ok ? 'reported ✓' : `failed: ${res?.error ?? '?'}`;
      if (res?.ok) {
        textarea.value = '';
        setTimeout(() => {
          form.style.display = 'none';
          sendBtn.textContent = 'capture + send';
          sendBtn.disabled = false;
        }, 1200);
        return;
      }
    } catch (err) {
      sendBtn.textContent = `failed: ${err?.message ?? err}`;
    }
    sendBtn.disabled = false;
  });

  root.append(head, form, body);
  document.documentElement.appendChild(root);

  head.addEventListener('click', (e) => {
    if (e.target !== pingBtn) root.classList.toggle('collapsed');
  });

  function setStatus(ok, text) {
    dot.className = 'sd-dot ' + (ok === null ? '' : ok ? 'ok' : 'bad');
    if (text !== undefined) title.textContent = text;
  }

  function log({ key, verdict, extra = '' }) {
    const row = document.createElement('div');
    row.className = 'sd-row';
    const time = document.createElement('span');
    time.className = 'sd-time';
    time.textContent = new Date().toTimeString().slice(0, 8);
    const keyEl = document.createElement('span');
    keyEl.className = 'sd-key';
    keyEl.textContent = shortKey(key);
    keyEl.title = key ?? '';
    const v = document.createElement('span');
    v.className = 'sd-verdict ' + verdict;
    v.textContent = verdict === 'flag' ? 'FLAG' : verdict === 'pass' ? 'pass' : verdict === 'err' ? 'ERR' : '…';
    const x = document.createElement('span');
    x.className = 'sd-extra';
    x.textContent = extra;
    x.title = extra;
    row.append(time, keyEl, v, x);
    body.prepend(row);
    while (body.children.length > 60) body.lastChild.remove();
  }

  pingBtn.addEventListener('click', () => {
    title.textContent = `pinging… (v${version})`;
    const timer = setTimeout(() => setStatus(false, 'bg timeout — reload ext?'), 5000);
    chrome.runtime.sendMessage({ type: 'ping' }, (res) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError || !res) {
        setStatus(false, 'bg unreachable');
        return;
      }
      if (!res.hasToken) setStatus(false, 'no token set — see options');
      else setStatus(res.ok, res.ok ? `worker ${res.status}` : `worker ${res.status}`);
    });
  });

  function setPlatform(name) {
    platformEl.textContent = `· ${name ?? 'no adapter'}`;
  }

  return { log, setStatus, setPlatform };
}
