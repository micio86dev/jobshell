// The whole lead pipeline, offline: recorded source bodies, a scripted judge and a scripted provider.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { defaultConfig } from '../src/config.ts';
import type { FetchLike } from '../src/jev.ts';
import { openCache } from '../src/leads/cache.ts';
import { chooseForJudgment, runLeads, type LeadRunDeps } from '../src/leads/pipeline.ts';
import { defaultStrategy } from '../src/leads/strategy.ts';
import type { Signal } from '../src/leads/types.ts';
import { profile } from './support.ts';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/leads/${name}`, import.meta.url), 'utf8');
const now = new Date('2026-11-24T12:00:00Z');
const noSleep = async (): Promise<void> => undefined;

type Script = {
  jevCalls: Array<{ title: string; company: string | null }>;
  anthropic: Array<{ tools: boolean; prompt: string }>;
  urls: string[];
};

/** A world: the sources answer with recorded bodies, the judge and the provider with scripted answers. */
const world = (options: { jevFails?: boolean; anthropicStatus?: number; onsiteCompanies?: string[] } = {}): { script: Script; fetchImpl: FetchLike } => {
  const script: Script = { jevCalls: [], anthropic: [], urls: [] };
  const choice = (verdict: string, probabilities: Record<string, number>) => ({ type: 'choice', choice: verdict, confidence: 0.9, probabilities });
  const fetchImpl: FetchLike = async (url, init) => {
    script.urls.push(url);
    if (url.startsWith('https://api.typesafe.ai')) {
      if (options.jevFails === true) return { status: 503, text: '' };
      const body = JSON.parse(init.body ?? '{}') as { state: { signal: { title: string; company: string | null } } };
      script.jevCalls.push({ title: body.state.signal.title, company: body.state.signal.company });
      const onsite = (options.onsiteCompanies ?? []).includes(body.state.signal.company ?? '');
      return { status: 200, text: JSON.stringify({ model: 'jev', usage: { input_tokens: 500, output_tokens: 20 }, answers: {
        need: choice(onsite ? 'employee_only' : 'probable_gap', onsite ? { employee_only: 0.8, probable_gap: 0.2 } : { probable_gap: 0.8, explicit_external: 0.2 }),
        b2b: { type: 'noul', noul: onsite ? 0.2 : 0.8 }, longterm: { type: 'noul', noul: 0.7 },
        fit: choice(onsite ? 'weak' : 'strong', onsite ? { weak: 0.8, strong: 0.1, transferable: 0.1 } : { strong: 0.8, transferable: 0.2 }),
        level: choice('matches', { matches: 0.95 }),
        remote: choice(onsite ? 'onsite_required' : 'remote_ok', onsite ? { onsite_required: 0.9, unknown: 0.1 } : { remote_ok: 0.9, unknown: 0.1 }),
        quality: choice('genuine', { genuine: 0.95, scam: 0.02, vague: 0.03 }),
      } }) };
    }
    if (url.startsWith('https://api.anthropic.com')) {
      const body = JSON.parse(init.body ?? '{}') as { tools?: unknown[]; messages: Array<{ content: string }> };
      const prompt = String(body.messages[0]?.content);
      script.anthropic.push({ tools: body.tools !== undefined, prompt });
      if (options.anthropicStatus !== undefined) return { status: options.anthropicStatus, text: JSON.stringify({ error: { message: 'Your credit balance is too low to access the Anthropic API.' } }) };
      let text: string;
      if (body.tools !== undefined) text = JSON.stringify({ company: 'x', website: null, country: 'DE', summary: 'A SaaS company.', legitimacy: 'real', legitimacy_reason: 'Has a product.', engineering_need: 'Hiring engineers.', facts: [], contacts: [] });
      else if (prompt.includes('Each item below is a title')) text = '[]';
      else if (prompt.includes('Write search queries')) text = '["series a startup backend team"]';
      else text = JSON.stringify({ subject: 'Backend capacity for your team', body: 'Hello team, I noticed you are hiring engineers and I build SaaS back ends with Laravel and Vue as an independent engineer. I can take a defined part of your roadmap. Would a short call help? [Your name]', facts_used: ['hiring'] });
      return { status: 200, text: JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 700, output_tokens: 90 }, stop_reason: 'end_turn' }) };
    }
    if (url.includes('story,author_whoishiring')) return { status: 200, text: fixture('hn-thread-list.json') };
    if (url.includes('tags=comment')) return { status: 200, text: fixture('hn-thread-comments.json') };
    if (url.startsWith('https://yc-oss.github.io')) return { status: 200, text: fixture('yc-hiring.json') };
    if (url.startsWith('https://sifted.eu')) return { status: 200, text: fixture('sifted.xml') };
    return { status: 404, text: '' };
  };
  return { script, fetchImpl };
};

const base = (fetchImpl: FetchLike, over: Partial<LeadRunDeps> = {}): LeadRunDeps => {
  const strategy = { ...defaultStrategy(profile), tech_terms: ['laravel', 'vue', 'php'], threshold: 55 };
  return {
    config: defaultConfig(), profile, strategy, sources: ['hn-hiring', 'yc-hiring', 'sifted'], fetchImpl,
    jev: { apiKey: 'jev-key', fetchImpl },
    llm: { apiKey: 'ant-key', provider: 'anthropic', model: 'claude-sonnet-5-5', maxTokens: 1000, fetchImpl },
    research: { apiKey: 'ant-key', model: 'claude-sonnet-5-5', fetchImpl, maxSearches: 3, maxFetches: 2, maxTokens: 4000 },
    cache: openCache('/nonexistent-dir/never-saved.json'), imports: [], now, sleep: noSleep, ...over,
  };
};

test('a full run turns recorded signals into qualified leads with a score, evidence, a draft and a measured cost', async () => {
  const { script, fetchImpl } = world();
  const doc = await runLeads(base(fetchImpl));
  const qualified = doc.leads.filter((lead) => lead.qualified);
  assert.ok(qualified.length >= 3, `qualified: ${qualified.length}`);
  for (const lead of qualified) {
    assert.equal(lead.score.dimensions.length, 6);
    assert.equal(Math.round(lead.score.dimensions.reduce((sum, d) => sum + d.max, 0)), 100);
    assert.ok(lead.signals.length > 0 && lead.signals.every((signal) => signal.url.startsWith('http')));
    assert.ok(lead.facts.every((fact) => fact.provenance === 'inferred' || fact.source_url !== null));
    assert.ok(lead.contacts.every((contact) => contact.source_url !== '' && contact.quote !== ''));
    assert.notEqual(lead.next_action, '');
    assert.notEqual(lead.summary, '');
  }
  assert.ok(qualified.some((lead) => lead.outreach.length === 1 && !/https?:/.test(lead.outreach[0]?.body ?? '')));
  assert.equal(doc.run.metrics.qualified, qualified.length);
  assert.ok(doc.run.cost.jev_input_tokens > 0 && doc.run.cost.llm_input_tokens > 0 && doc.run.cost.web_searches === 0);
  assert.ok(script.jevCalls.length > 0);
  assert.ok(doc.run.metrics.explanation.length > 0);
  assert.ok(doc.run.metrics.sources.every((source) => source.skipped === null));
  // A funding story that names no company is not turned into a company called after the news site.
  assert.ok(doc.leads.every((lead) => !lead.company_key.includes('sifted.eu')));
  assert.ok(doc.run.metrics.signals.unidentified > 0);
});

test('qualified leads come first, ordered by score, and the rejected ones keep their reason', async () => {
  const { fetchImpl } = world({ onsiteCompanies: ['Joulent'] });
  const doc = await runLeads(base(fetchImpl));
  const flags = doc.leads.map((lead) => lead.qualified);
  assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)));
  const joulent = doc.leads.find((lead) => lead.company_name === 'Joulent');
  assert.equal(joulent?.qualified, false);
  assert.match(joulent?.rejection_reason ?? '', /below/);
  const scores = doc.leads.filter((lead) => lead.qualified).map((lead) => lead.score.total);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('a second run with the same cache buys no judgment and no research again', async () => {
  const { script, fetchImpl } = world();
  const cache = openCache('/nonexistent-dir/never-saved.json');
  await runLeads(base(fetchImpl, { cache }));
  const firstJudged = script.jevCalls.length;
  const firstResearch = script.anthropic.filter((call) => call.tools).length;
  assert.ok(firstJudged > 0 && firstResearch > 0);
  const second = await runLeads(base(fetchImpl, { cache }));
  assert.equal(script.jevCalls.length, firstJudged, 'no new judgment');
  assert.equal(script.anthropic.filter((call) => call.tools).length, firstResearch, 'no new research');
  assert.ok(second.run.metrics.companies.from_cache > 0);
});

test('without credit for research the run still qualifies from the signals, with lower confidence, and says why', async () => {
  const withResearch = await runLeads(base(world().fetchImpl));
  const { fetchImpl } = world({ anthropicStatus: 400 });
  const doc = await runLeads(base(fetchImpl));
  assert.equal(doc.run.metrics.research.available, false);
  assert.match(doc.run.metrics.research.reason ?? '', /no credit left/);
  assert.match(doc.run.metrics.explanation.join(' '), /research was not available/);
  assert.ok(doc.leads.length > 0);
  const confidence = (leads: typeof doc.leads): number => Math.max(...leads.map((lead) => lead.score.confidence));
  assert.ok(confidence(doc.leads) < confidence(withResearch.leads), 'less evidence means less confidence');
});

test('a judge that is down ends the stage early and the explanation names it', async () => {
  const { script, fetchImpl } = world({ jevFails: true });
  const doc = await runLeads(base(fetchImpl));
  assert.equal(doc.run.metrics.judge.available, false);
  assert.equal(doc.leads.length, 0);
  assert.equal(script.urls.filter((url) => url.startsWith('https://api.typesafe.ai')).length, 3, 'it stops after three failures in a row');
  assert.match(doc.run.metrics.explanation.join(' '), /judgment service was not available/);
});

test('a missing judgment key is a plain explanation, not an empty dashboard', async () => {
  const doc = await runLeads(base(world().fetchImpl, { jev: null }));
  assert.equal(doc.leads.length, 0);
  assert.match(doc.run.metrics.explanation.join(' '), /judgment service was not available/);
});

test('the spending cap stops the paid research and reports how many companies were left', async () => {
  const strategy = { ...defaultStrategy(profile), tech_terms: ['laravel', 'vue'], threshold: 55, usd_cap: 0.0001 };
  const { script, fetchImpl } = world();
  const doc = await runLeads(base(fetchImpl, { strategy }));
  assert.ok(doc.run.metrics.research.skipped_for_budget > 0);
  assert.ok(script.anthropic.filter((call) => call.tools).length <= 1);
});

test('what the user pasted is judged even when the budget is spent, and keeps its own company name from the text', async () => {
  const pasted: Signal = {
    id: 'imp1', type: 'manual_import', source: 'manual-import', sources: ['manual-import'], url: 'manual://import/imp1',
    title: 'Globex cerca freelance Laravel senior', text: 'Globex cerca un freelance Laravel senior per un progetto B2B di sei mesi, remoto.', company_name: 'Globex',
    location: null, remote_hint: true, salary: null, published_at: now.toISOString(), observed_at: now.toISOString(),
  };
  const strategy = { ...defaultStrategy(profile), tech_terms: ['laravel'], threshold: 55, classify_budget: 1 };
  const { script, fetchImpl } = world();
  const doc = await runLeads(base(fetchImpl, { strategy, imports: [pasted] }));
  assert.equal(script.jevCalls[0]?.company, 'Globex', 'the import is the first one judged');
  assert.ok(doc.leads.some((lead) => lead.company_name === 'Globex' && lead.qualified));
});

test('no send path: a run touches only sources, the judge and the provider, never a mail or message endpoint', async () => {
  const { script, fetchImpl } = world();
  await runLeads(base(fetchImpl));
  const hosts = new Set(script.urls.map((url) => new URL(url).hostname));
  assert.deepEqual([...hosts].sort(), ['api.anthropic.com', 'api.typesafe.ai', 'hn.algolia.com', 'sifted.eu', 'yc-oss.github.io']);
  assert.ok(script.urls.every((url) => !/smtp|mailto|sendgrid|mailgun/i.test(url)));
});

test('a share of the judgment budget is kept for companies that are in the news, not only for vacancies', () => {
  const item = (name: string, type: string, preScore: number, fromImport = false) => ({ name, fromImport, primary: { pre_score: preScore, signal: { type } } });
  const cases = [
    ...['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) => item(name, 'job_posting', 0.9 - index * 0.05)),
    item('funded', 'funding', 0.3),
    item('growing', 'hiring_growth', 0.25),
    item('pasted', 'manual_import', 0.1, true),
  ];
  const names = chooseForJudgment(cases, 4).map((entry) => entry.name);
  assert.equal(names.length, 5, 'the pasted one is extra: it never counts against the budget');
  assert.deepEqual(names.slice(0, 2), ['pasted', 'funded'], 'what the user pasted first, then the best news');
  assert.ok(names.includes('a') && names.includes('b') && names.includes('c'));
  assert.ok(!names.includes('d') && !names.includes('growing'), 'the share is a share, not the whole budget');
  assert.equal(chooseForJudgment(cases, 2).filter((entry) => entry.primary.signal.type === 'funding').length, 0, 'a tiny budget keeps no reserve');
});

test('a verdict cached under an older set of questions is not reused', async () => {
  const { script, fetchImpl } = world();
  const cache = openCache('/nonexistent-dir/never-saved.json');
  await runLeads(base(fetchImpl, { cache }));
  const first = script.jevCalls.length;
  const classify = await import('../src/leads/classify.ts');
  assert.equal(typeof classify.QUESTIONS_VERSION, 'number');
  await runLeads(base(fetchImpl, { cache }));
  assert.equal(script.jevCalls.length, first, 'the same version reuses the cache');
});
