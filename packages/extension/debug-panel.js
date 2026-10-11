/**
 * Debug panel: fixed bottom-right overlay for development sessions.
 * Shows a readable, expandable card for each analyzed video so behavior is
 * visible without opening devtools. Collapsible; click the header to toggle.
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
    '.slop-debug { position: fixed; right: 12px; bottom: 12px; z-index: 10000; width: min(520px, calc(100vw - 24px));',
    '  background: rgba(16,16,16,.92); border: 1px solid #333; border-radius: 8px;',
    '  font: 12px/1.45 system-ui, sans-serif; color: #ccc; }',
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
    '.slop-debug .sd-body { max-height: min(620px, 70vh); overflow-y: auto; padding: 6px; }',
    '.slop-debug.collapsed .sd-body { display: none; }',
    '.slop-debug .sd-card { border: 1px solid #333; border-radius: 6px; margin-bottom: 6px; overflow: hidden; }',
    '.slop-debug .sd-card:last-child { margin-bottom: 0; }',
    '.slop-debug .sd-card-head { display: flex; align-items: center; gap: 8px; width: 100%;',
    '  padding: 9px 10px; background: #1c1c1c; color: #eee; border: 0; text-align: left; cursor: pointer; }',
    '.slop-debug .sd-card-head:hover { background: #252525; }',
    '.slop-debug .sd-card-title { font-weight: 700; }',
    '.slop-debug .sd-card-meta { color: #999; }',
    '.slop-debug .sd-card-status { margin-left: auto; font-weight: 700; }',
    '.slop-debug .sd-card-status.pass { color: #3fb950; } .slop-debug .sd-card-status.flag { color: #f85149; }',
    '.slop-debug .sd-card-status.error { color: #d29922; } .slop-debug .sd-card-status.analyzing { color: #aaa; }',
    '.slop-debug .sd-details { padding: 9px 10px; background: #131313; }',
    '.slop-debug .sd-explanation { color: #999; font-size: 11px; line-height: 1.4; margin-bottom: 9px; }',
    '.slop-debug .sd-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 12px; margin-bottom: 9px; }',
    '.slop-debug .sd-metric { display: flex; justify-content: space-between; gap: 8px; color: #999; }',
    '.slop-debug .sd-value { color: #eee; text-align: right; }',
    '.slop-debug .sd-timeline { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid #2a2a2a; padding-top: 7px; }',
    '.slop-debug .sd-event { display: grid; grid-template-columns: 104px 1fr; gap: 8px; }',
    '.slop-debug .sd-event-name { color: #bbb; } .slop-debug .sd-event-time { color: #777; text-align: right; }',
    '.slop-debug .sd-empty { color: #888; padding: 12px 8px; text-align: center; }',
  ].join('\n');
  document.head.appendChild(style);
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

  const exportBtn = document.createElement('button');
  exportBtn.className = 'sd-ping';
  exportBtn.textContent = 'export';

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
  head.append(exportBtn, pingBtn);

  const body = document.createElement('div');
  body.className = 'sd-body';
  const jobs = new Map();
  const expanded = new Set();

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

  function addEvent(event) {
    if (typeof event?.jobId !== 'number') return;
    if (!jobs.has(event.jobId)) jobs.set(event.jobId, []);
    jobs.get(event.jobId).push(event);
    while (jobs.size > 60) jobs.delete(jobs.keys().next().value);
    renderJobs();
  }

  function log({ event } = {}) {
    if (event) {
      addEvent(event);
    }
  }

  function eventLabel(event) {
    const labels = {
      'capture.complete': 'Frames captured',
      'request.complete': 'Worker response received',
      'analysis.complete': 'Analysis complete',
      'overlay.resume': 'Video resumed',
      'overlay.skip': 'Skip clicked',
    };
    return labels[event.type] ?? event.type;
  }

  function duration(value) {
    if (typeof value !== 'number') return 'not recorded';
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    return `${value} ms`;
  }

  function confidence(value) {
    return typeof value === 'number' ? `${Math.round(value * 100)}%` : 'not recorded';
  }

  function typeLabel(value) {
    return {
      organic: 'Organic content',
      absurdist_ai: 'AI absurdity bait',
      synthetic_parody: 'AI face-swap parody',
      static_ai_slideshow: 'Static AI slideshow',
      other_ai: 'Other AI-generated content',
    }[value] ?? value ?? 'not recorded';
  }

  function jobView(jobId, events) {
    const completed = [...events].reverse().find((event) => event.type === 'analysis.complete');
    const capture = events.find((event) => event.type === 'capture.complete');
    const request = [...events].reverse().find((event) => event.type === 'request.complete');
    const requestSource = request ?? completed;
    const status = completed?.outcome ?? events.at(-1)?.outcome ?? 'analyzing';
    const statusLabel = {
      pass: 'Passed', flag: 'Flagged', error: 'Failed open', analyzing: 'Analyzing', stale: 'Stale',
    }[status] ?? status;
    const card = document.createElement('article');
    card.className = 'sd-card';

    const head = document.createElement('button');
    head.className = 'sd-card-head';
    head.type = 'button';
    head.setAttribute('aria-expanded', expanded.has(jobId) ? 'true' : 'false');
    const title = document.createElement('span');
    title.className = 'sd-card-title';
    title.textContent = `Video ${jobId}`;
    const meta = document.createElement('span');
    meta.className = 'sd-card-meta';
    meta.textContent = events.find((event) => event.platform)?.platform ?? 'unknown platform';
    const state = document.createElement('span');
    state.className = `sd-card-status ${status}`;
    state.textContent = statusLabel;
    head.append(title, meta, state);

    const details = document.createElement('div');
    details.className = 'sd-details';
    details.hidden = !expanded.has(jobId);
    const metrics = document.createElement('div');
    metrics.className = 'sd-metrics';
    const metricValues = [
      ['Total elapsed', duration(completed?.totalMs)],
      ['Frame capture', duration(capture?.captureMs)],
      ['Worker round-trip', duration(requestSource?.requestMs)],
      ['Worker messages', String(requestSource?.requestCount ?? events.filter((event) => event.type === 'request.start').length)],
      ['Detected type', typeLabel(completed?.categoryChoice)],
      ['Type confidence', confidence(completed?.categoryConfidence)],
      ['Result', completed?.outcome === 'flag' ? 'Likely AI-generated' : completed?.outcome === 'pass' ? 'Passed' : completed?.errorCode ?? 'In progress'],
      ['Cache', completed?.cache ?? 'not recorded'],
    ];
    for (const [label, value] of metricValues) {
      const metric = document.createElement('div');
      metric.className = 'sd-metric';
      metric.append(document.createTextNode(label), Object.assign(document.createElement('span'), { className: 'sd-value', textContent: value }));
      metrics.append(metric);
    }
    const timeline = document.createElement('div');
    timeline.className = 'sd-timeline';
    const visibleEvents = events.filter((event) => ['capture.complete', 'request.complete', 'analysis.complete'].includes(event.type));
    for (const event of visibleEvents) {
      const row = document.createElement('div');
      row.className = 'sd-event';
      const label = document.createElement('span');
      label.className = 'sd-event-name';
      label.textContent = eventLabel(event);
      const detail = document.createElement('span');
      detail.className = 'sd-event-time';
      detail.textContent = event.requestMs !== undefined ? duration(event.requestMs)
        : event.captureMs !== undefined ? duration(event.captureMs)
        : event.totalMs !== undefined ? duration(event.totalMs)
        : event.skipOutcome ? event.skipOutcome
        : event.errorCode ?? event.outcome ?? '';
      row.append(label, detail);
      timeline.append(row);
    }
    details.append(metrics, timeline);
    head.addEventListener('click', () => {
      if (expanded.has(jobId)) expanded.delete(jobId);
      else expanded.add(jobId);
      renderJobs();
    });
    card.append(head, details);
    return card;
  }

  function renderJobs() {
    body.replaceChildren();
    if (!jobs.size) {
      const empty = document.createElement('div');
      empty.className = 'sd-empty';
      empty.textContent = 'No videos analyzed yet.';
      body.append(empty);
      return;
    }
    [...jobs.entries()].reverse().forEach(([jobId, events]) => {
      body.append(jobView(jobId, events));
    });
  }

  exportBtn.addEventListener('click', () => {
    const data = hooks.onExport?.();
    if (!data) return;
    const blob = new Blob([data], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'deslop-diagnostics.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });

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
