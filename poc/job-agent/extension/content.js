// Content script: reads the postings on the page the user has open and asks the
// local agent to score them.
//
// It never navigates, never paginates, never touches cookies and never runs on its
// own: it waits for a message from the popup, which is a click. That boundary is the
// whole reason this is allowed where a crawler is not.

/** Where a posting lives on each supported site. */
const PATTERNS = [
  { source: 'linkedin', match: /\/jobs\/view\/(\d+)/, id: (m) => m[1] },
  { source: 'indeed', match: /[?&]jk=([A-Za-z0-9]+)/, id: (m) => m[1] },
  { source: 'stepstone', match: /\/stellenangebote--[^/]*?(\d+)\.html/, id: (m) => m[1] },
  { source: 'tecnoempleo', match: /\/ofertas-trabajo\/([a-z0-9-]+)/i, id: (m) => m[1] },
  { source: 'infojobs', match: /\/offers\/([a-z0-9]+)/i, id: (m) => m[1] },
  { source: 'subito', match: /\/annunci\/([a-z0-9-]+\/\d+)/i, id: (m) => m[1] },
  { source: 'reteinformaticalavoro', match: /\/annuncio\/([a-z0-9-]+)/i, id: (m) => m[1] },
  { source: 'freelancermap', match: /\/projekt\/([a-z0-9-]+)/i, id: (m) => m[1] },
  { source: 'freework', match: /\/fr\/tech-it\/emploi\/([a-z0-9-]+)/i, id: (m) => m[1] },
  { source: 'welcometothejungle', match: /\/companies\/[^/]+\/jobs\/([a-z0-9-]+)/i, id: (m) => m[1] },
  { source: 'getonbrd', match: /\/jobs\/([a-z0-9-]+)/i, id: (m) => m[1] },
  { source: 'facebook', match: /\/groups\/[^/]+\/posts\/(\d+)/, id: (m) => m[1] },
];

const text = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The nearest ancestor that looks like one posting card. */
const card = (anchor) => anchor.closest('li, article, [role="article"], div[class*="card"]') ?? anchor.parentElement;

/** Collect the postings visible on this page, deduplicated by id. */
const collect = () => {
  const found = new Map();
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.href;
    for (const pattern of PATTERNS) {
      const match = pattern.match.exec(href);
      if (match === null) continue;
      const id = pattern.id(match);
      if (typeof id !== 'string' || found.has(`${pattern.source}:${id}`)) continue;
      const container = card(anchor);
      const heading = container?.querySelector('h1, h2, h3, h4, [role="heading"]');
      const title = text(heading) || text(anchor);
      if (title.length === 0) continue;
      found.set(`${pattern.source}:${id}`, {
        source: pattern.source,
        id,
        title: title.slice(0, 200),
        url: href.split('?')[0],
        company: null,
        location: null,
        remote_hint: /\b(remote|remoto|remota|smart working|home office)\b/i.test(text(container)),
        description: text(container).slice(0, 4000),
        published_at: null,
        salary: null,
      });
      break;
    }
  }
  return [...found.values()].slice(0, 40);
};

/** Paint the score next to each posting we could match back to an anchor. */
const annotate = (results) => {
  for (const result of results) {
    // Exact match on the URL without its query: a prefix match would badge
    // /jobs/view/12 with the score of /jobs/view/123.
    const anchor = [...document.querySelectorAll('a[href]')].find(
      (candidate) => candidate.href.split('?')[0] === result.url,
    );
    if (anchor === undefined) continue;
    const container = card(anchor);
    if (container === null) continue;
    const badge = document.createElement('span');
    const percent = Math.round(result.probability * 100);
    badge.textContent = ` ${percent}%`;
    badge.title = `openjob: ${result.verdict} (${result.stack_stance})`;
    badge.style.cssText = [
      'display:inline-block',
      'margin-left:6px',
      'padding:1px 6px',
      'border-radius:9999px',
      'font:600 11px/1.6 ui-sans-serif,system-ui,sans-serif',
      percent >= 90 ? 'background:#dcfce7;color:#166534' : percent >= 70 ? 'background:#fef9c3;color:#854d0e' : 'background:#f1f5f9;color:#475569',
    ].join(';');
    container.prepend(badge);
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'score-page') return undefined;
  const postings = collect();
  if (postings.length === 0) {
    sendResponse({ ok: false, error: 'no postings found on this page' });
    return true;
  }
  // The popup sends the bridge URL, so a bridge started on another port still works.
  const bridge = typeof message.bridge === 'string' ? message.bridge.replace(/\/+$/, '') : '';
  if (bridge.length === 0) {
    sendResponse({ ok: false, error: 'no bridge URL' });
    return true;
  }
  fetch(`${bridge}/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openjob-token': message.token },
    body: JSON.stringify({ postings }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`bridge answered ${response.status}`);
      const body = await response.json();
      annotate(body.results ?? []);
      sendResponse({
        ok: true,
        scored: (body.results ?? []).length,
        failed: (body.errors ?? []).length,
        threshold: body.threshold,
      });
    })
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
