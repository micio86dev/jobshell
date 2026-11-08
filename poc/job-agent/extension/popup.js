// The popup is the human gesture: nothing happens on this page until this button is
// clicked, and the token is stored locally so it is asked once per browser profile.

const tokenInput = document.getElementById('token');
const statusLine = document.getElementById('status');
const button = document.getElementById('score');

const setStatus = (message) => {
  statusLine.textContent = message;
};

// Session storage keeps the token in memory: it dies with the browser, so a stale
// token from a previous bridge run cannot linger in the profile.
chrome.storage.session.get(['token'], (stored) => {
  if (typeof stored.token === 'string') tokenInput.value = stored.token;
});

tokenInput.addEventListener('change', () => {
  chrome.storage.session.set({ token: tokenInput.value.trim() });
});

button.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (token.length === 0) {
    setStatus('paste the bridge token first');
    return;
  }
  chrome.storage.session.set({ token });
  setStatus('reading the page…');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    setStatus('no active tab');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'score-page', token }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(`this page is not supported: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (response?.ok) setStatus(`scored ${response.scored} postings (threshold ${Math.round(response.threshold * 100)}%)`);
    else setStatus(`failed: ${response?.error ?? 'unknown error'}`);
  });
});
