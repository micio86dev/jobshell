// The popup is the human gesture: nothing happens on this page until this button is
// clicked. It only needs the bridge URL, remembered for the browser session.

const bridgeInput = document.getElementById('bridge');
const statusLine = document.getElementById('status');
const button = document.getElementById('score');

const setStatus = (message) => {
  statusLine.textContent = message;
};

// Session storage keeps the URL in memory: it dies with the browser.
chrome.storage.session.get(['bridge'], (stored) => {
  if (typeof stored.bridge === 'string') bridgeInput.value = stored.bridge;
  void probeBridge();
});

bridgeInput.addEventListener('change', () => {
  chrome.storage.session.set({ bridge: bridgeInput.value.trim() });
  void probeBridge();
});

/** Say whether the agent is running, so the user is never guessing. */
const probeBridge = async () => {
  const bridge = bridgeInput.value.trim().replace(/\/+$/, '');
  try {
    const response = await fetch(`${bridge}/health`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json();
    setStatus(`connected · threshold ${Math.round((body.threshold ?? 0) * 100)}%`);
  } catch {
    setStatus('the agent is not running: run make agent-bridge');
  }
};

button.addEventListener('click', async () => {
  const bridge = bridgeInput.value.trim();
  if (bridge.length === 0) {
    setStatus('set the bridge URL first');
    return;
  }
  setStatus('reading the page…');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    setStatus('no active tab');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'score-page', bridge }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(`this page is not supported: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (response?.ok) {
      const failed = response.failed > 0 ? `, ${response.failed} failed` : '';
      setStatus(`scored ${response.scored} postings${failed} (threshold ${Math.round(response.threshold * 100)}%)`);
    }
    else setStatus(`failed: ${response?.error ?? 'unknown error'}`);
  });
});
