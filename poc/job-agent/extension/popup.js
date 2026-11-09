// The popup is the human gesture: nothing happens on this page until this button is
// clicked, and the token is stored locally so it is asked once per browser profile.

const tokenInput = document.getElementById('token');
const bridgeInput = document.getElementById('bridge');
const statusLine = document.getElementById('status');
const button = document.getElementById('score');

const setStatus = (message) => {
  statusLine.textContent = message;
};

// Session storage keeps the token in memory: it dies with the browser, so a stale
// token from a previous bridge run cannot linger in the profile.
chrome.storage.session.get(['token', 'bridge'], (stored) => {
  if (typeof stored.token === 'string') tokenInput.value = stored.token;
  if (typeof stored.bridge === 'string') bridgeInput.value = stored.bridge;
});

const remember = () => {
  chrome.storage.session.set({
    token: tokenInput.value.trim(),
    bridge: bridgeInput.value.trim(),
  });
};
tokenInput.addEventListener('change', remember);
bridgeInput.addEventListener('change', remember);

button.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (token.length === 0) {
    setStatus('paste the bridge token first');
    return;
  }
  const bridge = bridgeInput.value.trim();
  if (bridge.length === 0) {
    setStatus('set the bridge URL first');
    return;
  }
  remember();
  setStatus('reading the page…');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    setStatus('no active tab');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'score-page', token, bridge }, (response) => {
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
