const DEFAULTS = {
  workerUrl: 'https://deslop-worker.rubemviscard2635.workers.dev/analyze',
  token: '',
  debugPanel: false,
};

const workerUrlEl = document.getElementById('workerUrl');
const tokenEl = document.getElementById('token');
const debugPanelEl = document.getElementById('debugPanel');
const statusEl = document.getElementById('status');

chrome.storage.sync.get(DEFAULTS, ({ workerUrl, token, debugPanel }) => {
  workerUrlEl.value = workerUrl;
  tokenEl.value = token;
  debugPanelEl.checked = debugPanel === true;
});

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.sync.set(
    {
      workerUrl: workerUrlEl.value.trim(),
      token: tokenEl.value.trim(),
      debugPanel: debugPanelEl.checked,
    },
    () => { statusEl.textContent = 'Saved.'; }
  );
});
