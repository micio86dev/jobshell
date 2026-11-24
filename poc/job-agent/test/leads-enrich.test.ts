// Enrichment: the model researches, code decides what counts as a fact. Offline: the provider is a fake
// that answers in the documented Messages API shape (server tool use, search results, fetched pages, citations).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FetchLike } from '../src/jev.ts';
import { CostMeter } from '../src/leads/cost.ts';
import { enrichCompany, enrichPrompt, signalFacts } from '../src/leads/enrich.ts';
import { research } from '../src/leads/research.ts';
import type { Signal } from '../src/leads/types.ts';

const PAGE = 'About Acme. Acme raised a EUR 8 million Series A in March 2026 led by Northzone. Our CTO Jo Doe leads a team of 40 engineers. Write to engineering@acme.test or see https://acme.test/team.';
const NEWS = 'Acme, the Berlin SaaS company, raised 8 million euros in its Series A, investors said on Tuesday.';

const answerOf = (json: unknown, extra: Record<string, unknown>[] = []): Record<string, unknown>[] => [
  { type: 'text', text: "I'll look for Acme." },
  { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'acme series a' } },
  { type: 'web_search_tool_result', tool_use_id: 's1', content: [
    { type: 'web_search_result', url: 'https://acme.test/about', title: 'About', page_age: 'May 2026', encrypted_content: 'x' },
    { type: 'web_search_result', url: 'https://news.test/acme-series-a/', title: 'Acme raises', page_age: 'March 2026', encrypted_content: 'y' },
  ] },
  { type: 'server_tool_use', id: 's2', name: 'web_fetch', input: { url: 'https://acme.test/about' } },
  { type: 'web_fetch_tool_result', tool_use_id: 's2', content: { type: 'web_fetch_result', url: 'https://acme.test/about', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: PAGE }, title: 'About' } } },
  { type: 'text', text: 'Acme raised money.', citations: [{ type: 'web_search_result_location', url: 'https://news.test/acme-series-a/', title: 'Acme raises', cited_text: NEWS.slice(0, 80) + '...' }] },
  ...extra,
  { type: 'text', text: JSON.stringify(json) },
];

const provider = (content: Record<string, unknown>[], over: Record<string, unknown> = {}): { calls: Array<{ url: string; body: Record<string, unknown> }>; fetchImpl: FetchLike } => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> });
      return { status: 200, text: JSON.stringify({ content, stop_reason: 'end_turn', usage: { input_tokens: 6000, output_tokens: 900, server_tool_use: { web_search_requests: 1 } }, ...over }) };
    },
  };
};

const deps = (fetchImpl: FetchLike) => ({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5', fetchImpl, maxSearches: 4, maxFetches: 3, maxTokens: 6000 });

const good = {
  company: 'Acme', website: 'https://www.acme.test/', country: 'DE', summary: 'Berlin SaaS company.', legitimacy: 'real', legitimacy_reason: 'Own site with a team page.',
  engineering_need: 'Growing team, fresh Series A.',
  facts: [
    { field: 'funding', value: 'EUR 8 million Series A', provenance: 'reported', source_url: 'https://news.test/acme-series-a', quote: 'raised 8 million euros in its Series A' },
    { field: 'company_size', value: '40 engineers', provenance: 'verified', source_url: 'https://acme.test/about', quote: 'a team of 40 engineers' },
    { field: 'revenue', value: '50 million EUR', provenance: 'verified', source_url: 'https://acme.test/about', quote: 'Acme earns 50 million EUR a year' },
    { field: 'investors', value: 'Northzone', provenance: 'verified', source_url: 'https://never-seen.test/page', quote: 'led by Northzone' },
    { field: 'growth', value: 'Doubling next year', provenance: 'inferred' },
    { field: 'funding', value: 'EUR 80 million', provenance: 'reported', source_url: 'https://news.test/acme-series-a', quote: 'raised 8 million euros in its Series A' },
  ],
  contacts: [
    { role: 'CTO', name: 'Jo Doe', channel: 'page', value: 'https://acme.test/team', source_url: 'https://acme.test/about', quote: 'Our CTO Jo Doe leads a team' },
    { role: 'Engineering', name: null, channel: 'email', value: 'engineering@acme.test', source_url: 'https://acme.test/about', quote: 'Write to engineering@acme.test' },
    { role: 'CEO', name: null, channel: 'email', value: 'ceo@acme.test', source_url: 'https://acme.test/about', quote: 'Write to ceo@acme.test' },
    { role: 'Founder', name: null, channel: 'email', value: 'founder@gmail.com', source_url: 'https://acme.test/about', quote: 'Write to founder@gmail.com' },
    { role: 'VP of Engineering', name: 'Sam Roe', channel: 'page', value: 'https://acme.test/team', source_url: 'https://acme.test/about', quote: 'Our CTO Jo Doe leads a team' },
  ],
};

test('the request carries the web tools within the budget, and the key only in its header', async () => {
  const { calls, fetchImpl } = provider(answerOf(good));
  await enrichCompany('Acme', [], null, deps(fetchImpl));
  const call = calls[0];
  assert.equal(call?.url, 'https://api.anthropic.com/v1/messages');
  const tools = call?.body['tools'] as Array<{ type: string; max_uses: number }>;
  assert.deepEqual(tools.map((tool) => [tool.type, tool.max_uses]), [['web_search_20250305', 4], ['web_fetch_20250910', 3]]);
  // Login-walled networks are blocked for both tools, and the prompt says so.
  for (const tool of call?.body['tools'] as Array<{ blocked_domains: string[] }>) assert.ok(tool.blocked_domains.includes('linkedin.com') && tool.blocked_domains.includes('facebook.com'));
  assert.match(JSON.stringify(call?.body['messages']), /Do not use LinkedIn, Facebook, Instagram or X/);
  assert.ok(!JSON.stringify(call?.body).includes('sk-ant-test'));
});

test('a fact survives only with a page the research touched and words that are in it', async () => {
  const { fetchImpl } = provider(answerOf(good));
  const result = await enrichCompany('Acme', [], null, deps(fetchImpl));
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  const byValue = (value: string) => result.facts.find((fact) => fact.value === value);
  // A quote found in a cited passage counts, and the trailing cut of the provider is not part of the page.
  assert.deepEqual([byValue('EUR 8 million Series A')?.provenance, byValue('EUR 8 million Series A')?.source_url], ['reported', 'https://news.test/acme-series-a']);
  // Own site and the words are in the page: verified.
  assert.equal(byValue('40 engineers')?.provenance, 'verified');
  // The quote is not in the page: the figure falls back to the model's reading.
  assert.deepEqual([byValue('50 million EUR')?.provenance, byValue('50 million EUR')?.source_url], ['inferred', null]);
  // A page the research never touched cannot be a source.
  assert.equal(byValue('Northzone')?.provenance, 'inferred');
  // The number is not in its quote.
  assert.equal(byValue('EUR 80 million')?.provenance, 'inferred');
  // The model's own reading stays marked as such.
  assert.equal(byValue('Doubling next year')?.provenance, 'inferred');
  assert.equal(result.dropped.filter((drop) => drop.kind === 'fact').length, 3);
});

test('"verified" needs the company site or a register: a news page is only "reported"', async () => {
  const claim = { ...good, facts: [{ field: 'funding', value: 'EUR 8 million Series A', provenance: 'verified', source_url: 'https://news.test/acme-series-a', quote: 'raised 8 million euros in its Series A' }], contacts: [] };
  const result = await enrichCompany('Acme', [], null, deps(provider(answerOf(claim)).fetchImpl));
  assert.equal(result.status === 'ok' ? result.facts[0]?.provenance : null, 'reported');
});

test('a contact needs the page, the words, and for an email the address itself in the page', async () => {
  const result = await enrichCompany('Acme', [], null, deps(provider(answerOf(good)).fetchImpl));
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.contacts.map((contact) => contact.value).sort(), ['engineering@acme.test', 'https://acme.test/team']);
  assert.ok(result.contacts.every((contact) => contact.verified && contact.source_url.startsWith('https://acme.test/')));
  const reasons = result.dropped.filter((drop) => drop.kind === 'contact').map((drop) => drop.reason).sort();
  assert.deepEqual(reasons, ['the name is not in the quote', 'the quote is not in the page', 'the quote is not in the page'].sort());
});

test('an address on a free mailbox is never kept, even when the page shows it', async () => {
  const page = { ...good, contacts: [{ role: 'Founder', name: null, channel: 'email', value: 'founder@gmail.com', source_url: 'https://acme.test/about', quote: 'Write to founder@gmail.com' }] };
  const content = answerOf(page).map((block) => (block['type'] === 'web_fetch_tool_result' ? { ...block, content: { ...(block['content'] as object), content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: PAGE + ' Write to founder@gmail.com' } } } } : block));
  const result = await enrichCompany('Acme', [], null, deps(provider(content).fetchImpl));
  assert.equal(result.status === 'ok' ? result.contacts.length : -1, 0);
  assert.ok(result.status === 'ok' && result.dropped.some((drop) => /personal mailbox/.test(drop.reason)));
});

test('the website is accepted only when a page of that site was seen', async () => {
  const seen = await enrichCompany('Acme', [], null, deps(provider(answerOf(good)).fetchImpl));
  assert.equal(seen.status === 'ok' ? seen.website : 'x', 'https://acme.test');
  const invented = await enrichCompany('Acme', [], null, deps(provider(answerOf({ ...good, website: 'https://made-up.example' })).fetchImpl));
  assert.equal(invented.status === 'ok' ? invented.website : 'x', null);
});

test('an unusable provider answer is a reason, never an invented company', async () => {
  const garbage = await enrichCompany('Acme', [], null, deps(provider([{ type: 'text', text: 'I could not find anything useful.' }]).fetchImpl));
  assert.deepEqual(garbage, { status: 'unavailable', reason: 'the research answer did not match the expected shape' });
  const noMoney: FetchLike = async () => ({ status: 400, text: JSON.stringify({ error: { message: 'Your credit balance is too low to access the Anthropic API. sk-ant-test' } }) });
  const broke = await enrichCompany('Acme', [], null, deps(noMoney));
  assert.deepEqual(broke, { status: 'unavailable', reason: 'the Anthropic account has no credit left: add credit in the Anthropic console' });
  const refused = await enrichCompany('Acme', [], null, deps(async () => ({ status: 401, text: 'nope sk-ant-test' })));
  assert.equal(refused.status === 'unavailable' ? refused.reason.includes('sk-ant-test') : true, false);
  const offline = await enrichCompany('Acme', [], null, deps(async () => { throw new Error('socket hang up sk-ant-test'); }));
  assert.deepEqual(offline, { status: 'unavailable', reason: 'the research request failed' });
});

test('a paused turn is continued, and the usage of every request is added up', async () => {
  const bodies: Array<{ messages: unknown[] }> = [];
  let call = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(init.body ?? '{}') as { messages: unknown[] });
    call += 1;
    return call === 1
      ? { status: 200, text: JSON.stringify({ content: [{ type: 'server_tool_use', id: 's', name: 'web_search', input: {} }], stop_reason: 'pause_turn', usage: { input_tokens: 100, output_tokens: 10 } }) }
      : { status: 200, text: JSON.stringify({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 20 } }) };
  };
  const result = await research('s', 'p', deps(fetchImpl));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.usage, { input_tokens: 300, output_tokens: 30 });
  assert.equal(result.searches, 1);
  assert.equal(bodies[1]?.messages.length, 2, 'the paused turn is sent back so it can continue');
});

test('without an Anthropic key shape the prompt still names the evidence and forbids guessing', () => {
  const signal: Signal = { id: 'a', type: 'funding', source: 'sifted', sources: ['sifted'], url: 'https://sifted.eu/x', title: 'Acme raises 8m', text: null, company_name: 'Acme', location: null, remote_hint: null, salary: null, published_at: null, observed_at: '2026-11-24T00:00:00Z' };
  const prompt = enrichPrompt('Acme', [signal], null);
  assert.match(prompt, /Acme raises 8m/);
  assert.match(prompt, /Never guess an address/);
  assert.match(prompt, /CTO, Technical Director, VP of Engineering/);
});

test('facts proved by the signal itself are reported with the signal as the source', () => {
  const base: Omit<Signal, 'type' | 'title'> = { sources: ['x'], text: null, company_name: 'Acme', location: null, remote_hint: null, salary: null, published_at: null, observed_at: 'n', url: 'https://x.test/1', id: 'i', source: 'x' };
  const facts = signalFacts([
    { ...base, type: 'funding', title: 'Acme raises 8m' },
    { ...base, type: 'hiring_growth', title: 'Acme: SaaS', text: 'SaaS. Team size 25. Stage Early.' },
  ]);
  assert.deepEqual(facts.map((fact) => [fact.field, fact.provenance, fact.source_url]), [
    ['funding', 'reported', 'https://x.test/1'],
    ['company_size', 'reported', 'https://x.test/1'],
    ['hiring', 'reported', 'https://x.test/1'],
  ]);
});

test('the cost meter prices a known model, counts searches, and never prices what it cannot', () => {
  const meter = new CostMeter('claude-sonnet-5-5');
  meter.llm({ input_tokens: 1_000_000, output_tokens: 100_000 }, 3);
  meter.jev(5000);
  const summary = meter.summary();
  assert.equal(summary.llm_usd, 3);
  assert.equal(summary.search_usd, 0.03);
  assert.equal(summary.usd_known, 3.03);
  assert.equal(summary.includes_unpriced, true, 'Jev tokens have no published price here');
  const unknown = new CostMeter('some-future-model');
  unknown.llm({ input_tokens: 10, output_tokens: 10 }, 1);
  assert.equal(unknown.summary().llm_usd, null);
});

const worldOf = (pages: Array<{ url: string; text: string }>, answer: Record<string, unknown>): FetchLike => async () => ({
  status: 200,
  text: JSON.stringify({
    content: [
      { type: 'web_search_tool_result', tool_use_id: 's', content: pages.map((page) => ({ type: 'web_search_result', url: page.url, title: 't', encrypted_content: 'x' })) },
      ...pages.map((page) => ({ type: 'web_fetch_tool_result', tool_use_id: 'f', content: { type: 'web_fetch_result', url: page.url, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: page.text } } } })),
      { type: 'text', text: JSON.stringify(answer) },
    ],
    stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
  }),
});
const shell = { company: 'Acme', country: 'DE', summary: 's', legitimacy: 'real', facts: [] as unknown[], contacts: [] as unknown[] };

test('a news site claimed as the company site does not make its articles "verified"', async () => {
  const pages = [{ url: 'https://techcrunch.com/2026/acme-raises', text: 'Acme raised a EUR 8 million Series A, the company said on Tuesday.' }];
  const result = await enrichCompany('Acme', [], null, deps(worldOf(pages, { ...shell, website: 'https://techcrunch.com', facts: [{ field: 'funding', value: 'EUR 8 million Series A', provenance: 'verified', source_url: 'https://techcrunch.com/2026/acme-raises', quote: 'raised a EUR 8 million Series A' }] })));
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.website, null);
  assert.equal(result.facts[0]?.provenance, 'reported', 'a news article reports, it does not verify');
});

test('a site whose address has nothing to do with the company is not its website, even if a page names it', async () => {
  const pages = [{ url: 'https://random-blog.example/post', text: 'Acme is mentioned here as a customer.' }];
  const result = await enrichCompany('Acme', [], null, deps(worldOf(pages, { ...shell, website: 'https://random-blog.example' })));
  assert.equal(result.status === 'ok' ? result.website : 'x', null);
});

test('an address found in a press article, on another domain, is not the company contact whatever role is claimed', async () => {
  const pages = [
    { url: 'https://acme.test/about', text: 'About Acme. We are a SaaS company in Berlin.' },
    { url: 'https://press.test/story', text: 'Acme raised money. For press questions about Acme write to press@othercorp.test, the agency.' },
  ];
  const contact = { role: 'CTO', name: null, channel: 'email', value: 'press@othercorp.test', source_url: 'https://press.test/story', quote: 'write to press@othercorp.test' };
  const result = await enrichCompany('Acme', [], null, deps(worldOf(pages, { ...shell, website: 'https://acme.test', contacts: [contact] })));
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.contacts.length, 0);
  assert.ok(result.dropped.some((drop) => /company site and domain/.test(drop.reason)));
});

test('an address at the company domain on a page of another site is not a business contact either', async () => {
  const pages = [
    { url: 'https://acme.test/about', text: 'About Acme. We are a SaaS company in Berlin.' },
    { url: 'https://directory.test/acme', text: 'Acme: contact sales@acme.test for details.' },
  ];
  const contact = { role: 'Sales', name: null, channel: 'email', value: 'sales@acme.test', source_url: 'https://directory.test/acme', quote: 'contact sales@acme.test' };
  const result = await enrichCompany('Acme', [], null, deps(worldOf(pages, { ...shell, website: 'https://acme.test', contacts: [contact] })));
  assert.equal(result.status === 'ok' ? result.contacts.length : -1, 0);
});

test('a named person needs a role the search is for in the words quoted, and a profile page needs the company in them', async () => {
  const pages = [
    { url: 'https://acme.test/team', text: 'Acme team. Jo Doe, Office Manager. Sam Roe, CTO of Acme.' },
    { url: 'https://profiles.test/sam', text: 'Sam Roe is the CTO of Acme in Berlin.' },
    { url: 'https://profiles.test/other', text: 'Pat Lee is the CTO of Globex.' },
  ];
  const contacts = [
    { role: 'CTO', name: 'Jo Doe', channel: 'page', value: 'https://acme.test/team', source_url: 'https://acme.test/team', quote: 'Jo Doe, Office Manager' },
    { role: 'CTO', name: 'Sam Roe', channel: 'profile', value: 'https://profiles.test/sam', source_url: 'https://profiles.test/sam', quote: 'Sam Roe is the CTO of Acme in Berlin' },
    { role: 'CTO', name: 'Pat Lee', channel: 'profile', value: 'https://profiles.test/other', source_url: 'https://profiles.test/other', quote: 'Pat Lee is the CTO of Globex' },
    { role: 'CTO', name: 'Sam Roe', channel: 'profile', value: 'https://www.linkedin.com/in/sam', source_url: 'https://acme.test/team', quote: 'Sam Roe, CTO of Acme' },
  ];
  const result = await enrichCompany('Acme', [], null, deps(worldOf(pages, { ...shell, website: 'https://acme.test', contacts })));
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.contacts.map((contact) => contact.name), ['Sam Roe'], 'only the person whose words tie them to Acme in a searched role');
  const reasons = result.dropped.map((drop) => drop.reason).sort();
  assert.deepEqual(reasons, ['a profile that is not a public https page', 'the quote does not tie the person to the company', 'the role is not in the quote']);
});
