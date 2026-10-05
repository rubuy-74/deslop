const DEFAULTS = {
  workerUrl: 'https://deslop-worker.rubemviscard2635.workers.dev/analyze',
  token: '',
};

const workerUrlEl = document.getElementById('workerUrl');
const tokenEl = document.getElementById('token');
const statusEl = document.getElementById('status');

chrome.storage.sync.get(DEFAULTS, ({ workerUrl, token }) => {
  workerUrlEl.value = workerUrl;
  tokenEl.value = token;
});

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.sync.set(
    { workerUrl: workerUrlEl.value.trim(), token: tokenEl.value.trim() },
    () => { statusEl.textContent = 'Saved.'; }
  );
});
