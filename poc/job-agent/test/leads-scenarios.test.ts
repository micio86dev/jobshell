// The ten mandatory scenarios, run through the whole pipeline on the real profile (redacted copy) with the
// default strategy. Offline: the judge and the provider are scripted from the fixture, so this proves the
// scoring, the guards, the gate and the explanations. Whether the real judge agrees is measured by the
// live evaluation (`make leads-eval`), not claimed here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { defaultConfig } from '../src/config.ts';
import type { FetchLike } from '../src/jev.ts';
import { openCache } from '../src/leads/cache.ts';
import { runLeads, type LeadDocument, type LeadRunDeps } from '../src/leads/pipeline.ts';
import { defaultStrategy } from '../src/leads/strategy.ts';
import type { Signal } from '../src/leads/types.ts';
import { parseProfile } from '../src/profile.ts';

type Answer = Record<string, number>;
type Scenario = {
  id: string;
  title: string;
  expected: { qualified: boolean; country?: string; lang?: string; funding?: boolean; noJobPosting?: boolean; notEmploymentRejected?: boolean; droppedBy?: string[]; suspicious?: boolean; minTech?: number; minRemote?: number; minB2b?: number };
  signal: Signal;
  judge: { need: Answer; b2b: number; longterm: number; fit: Answer; level: Answer; remote: Answer; quality: string };
  research: null | { country: string; website: string | null; legitimacy: string; pages: Array<{ url: string; text: string }>; facts: Array<{ field: string; value: string; provenance: string; url: string; quote: string }>; contacts: Array<{ role: string; name: string | null; channel: string; value: string; url: string; quote: string }> };
};

const scenarios = JSON.parse(readFileSync(new URL('./fixtures/leads/scenarios.json', import.meta.url), 'utf8')) as Scenario[];
const parsed = parseProfile(JSON.parse(readFileSync(new URL('./fixtures/profile.real.redacted.json', import.meta.url), 'utf8')));
const profile = parsed.ok ? parsed.profile : (undefined as never);
// The default strategy, untouched: the threshold is not tuned to make a scenario pass.
const strategy = defaultStrategy(profile);
const now = new Date('2026-11-24T12:00:00Z');

const choice = (answer: Answer) => {
  const [verdict] = Object.entries(answer).sort((a, b) => b[1] - a[1])[0] ?? ['none'];
  return { type: 'choice', choice: verdict, confidence: 0.9, probabilities: answer };
};

const world = (): { jevTitles: string[]; fetchImpl: FetchLike } => {
  const jevTitles: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    if (url.startsWith('https://api.typesafe.ai')) {
      const body = JSON.parse(init.body ?? '{}') as { state: { signal: { title: string } } };
      const scenario = scenarios.find((candidate) => candidate.signal.title === body.state.signal.title);
      jevTitles.push(body.state.signal.title);
      if (scenario === undefined) return { status: 500, text: '' };
      const j = scenario.judge;
      const quality = j.quality === 'scam' ? { scam: 0.9, genuine: 0.05, vague: 0.05 } : { genuine: 0.95, scam: 0.02, vague: 0.03 };
      return { status: 200, text: JSON.stringify({ model: 'jev', usage: { input_tokens: 700, output_tokens: 20 }, answers: {
        need: choice(j.need), b2b: { type: 'noul', noul: j.b2b }, longterm: { type: 'noul', noul: j.longterm },
        fit: choice(j.fit), level: choice(j.level), remote: choice(j.remote), quality: choice(quality),
      } }) };
    }
    if (url.startsWith('https://api.anthropic.com')) {
      const body = JSON.parse(init.body ?? '{}') as { tools?: unknown[]; messages: Array<{ content: string }> };
      const prompt = String(body.messages[0]?.content);
      let content: Array<Record<string, unknown>>;
      if (body.tools !== undefined) {
        const scenario = scenarios.find((candidate) => candidate.signal.company_name !== null && prompt.includes(`Company: ${candidate.signal.company_name}`));
        const r = scenario?.research ?? { country: 'DE', website: null, legitimacy: 'unknown', pages: [], facts: [], contacts: [] };
        const answer = {
          company: scenario?.signal.company_name ?? 'x', website: r.website, country: r.country, summary: 'A company.', legitimacy: r.legitimacy, legitimacy_reason: 'Seen on its own pages.', engineering_need: 'Needs engineering capacity.',
          facts: r.facts.map((fact) => ({ field: fact.field, value: fact.value, provenance: fact.provenance, source_url: fact.url, quote: fact.quote })),
          contacts: r.contacts.map((contact) => ({ role: contact.role, name: contact.name, channel: contact.channel, value: contact.value, source_url: contact.url, quote: contact.quote })),
        };
        content = [
          { type: 'web_search_tool_result', tool_use_id: 's', content: r.pages.map((page) => ({ type: 'web_search_result', url: page.url, title: 'p', encrypted_content: 'x' })) },
          ...r.pages.map((page) => ({ type: 'web_fetch_tool_result', tool_use_id: 'f', content: { type: 'web_fetch_result', url: page.url, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: page.text } } } })),
          { type: 'text', text: JSON.stringify(answer) },
        ];
      } else if (prompt.includes('Each item below is a title')) content = [{ type: 'text', text: '[]' }];
      else if (prompt.includes('Write search queries')) content = [{ type: 'text', text: '[]' }];
      else content = [{ type: 'text', text: JSON.stringify({ subject: 'Backend capacity for your team', body: 'Hello team, I build SaaS back ends with Laravel and Vue as an independent engineer and could take a defined part of your roadmap. Would a short call help? [Your name]', facts_used: [] }) }];
      return { status: 200, text: JSON.stringify({ content, usage: { input_tokens: 800, output_tokens: 120 }, stop_reason: 'end_turn' }) };
    }
    return { status: 404, text: '' };
  };
  return { jevTitles, fetchImpl };
};

const runOne = async (signals: Signal[]): Promise<{ doc: LeadDocument; jevTitles: string[] }> => {
  const { jevTitles, fetchImpl } = world();
  const deps: LeadRunDeps = {
    config: defaultConfig(), profile, strategy, sources: [], fetchImpl,
    jev: { apiKey: 'jev', fetchImpl },
    llm: { apiKey: 'ant', provider: 'anthropic', model: 'claude-sonnet-5-5', maxTokens: 1000, fetchImpl },
    research: { apiKey: 'ant', model: 'claude-sonnet-5-5', fetchImpl, maxSearches: 3, maxFetches: 2, maxTokens: 4000 },
    cache: openCache('/nonexistent-dir/never-saved.json'), imports: signals, now, sleep: async () => undefined,
  };
  return { doc: await runLeads(deps), jevTitles };
};

for (const scenario of scenarios) {
  test(`${scenario.id}: ${scenario.title}`, async () => {
    const { doc, jevTitles } = await runOne([scenario.signal]);
    const lead = doc.leads.find((entry) => entry.company_name === scenario.signal.company_name);
    const e = scenario.expected;

    if (e.droppedBy !== undefined) {
      // Set aside before any paid judgment, for a reason that holds for any profile.
      assert.equal(lead, undefined);
      assert.equal(jevTitles.length, 0, 'no judgment was bought for it');
      for (const reason of e.droppedBy) assert.ok((doc.run.metrics.prefilter_dropped[reason] ?? 0) >= 1, `${reason} is counted`);
      return;
    }

    assert.ok(lead !== undefined, 'the company is analysed');
    assert.equal(lead.qualified, e.qualified, `${lead.company_name}: score ${lead.score.total}, ${lead.rejection_reason ?? 'qualified'}`);
    assert.equal(Math.round(lead.score.dimensions.reduce((sum, d) => sum + d.points, 0) * 10) / 10, lead.score.total, 'the total is the sum of the lines');
    assert.ok(lead.score.dimensions.every((d) => d.explanation.length > 15 && d.points >= 0 && d.points <= d.max));

    if (e.suspicious === true) {
      assert.match(lead.rejection_reason ?? '', /scheme or vague bait/);
      assert.ok(doc.run.metrics.judge.suspicious >= 1);
      return;
    }

    assert.notEqual(lead.summary, '');
    assert.notEqual(lead.why_match, '');
    assert.notEqual(lead.next_action, '');
    assert.equal(lead.outreach.length, 1);
    assert.equal(lead.outreach[0]?.lang, e.lang);
    assert.ok(!/https?:/.test(lead.outreach[0]?.body ?? ''));
    const dim = (name: string): number => lead.score.dimensions.find((d) => d.name === name)?.points ?? 0;
    if (e.minTech !== undefined) assert.ok(dim('technical_relevance') >= e.minTech, `technical ${dim('technical_relevance')}`);
    if (e.minRemote !== undefined) assert.ok(dim('remote_international') >= e.minRemote, `remote ${dim('remote_international')}`);
    if (e.minB2b !== undefined) assert.ok(dim('b2b_potential') >= e.minB2b, `b2b ${dim('b2b_potential')}`);
    if (e.funding === true) {
      const funding = lead.facts.find((fact) => fact.field === 'funding' && fact.provenance === 'reported');
      assert.ok(funding?.source_url !== null && funding?.source_url !== undefined, 'the funding is a reported fact with its page');
    }
    if (e.noJobPosting === true) assert.ok(lead.signals.every((signal) => signal.type !== 'job_posting'), 'it qualifies without any vacancy');
    if (e.notEmploymentRejected === true) {
      assert.equal(lead.rejection_reason, null);
      assert.match(lead.score.dimensions.find((d) => d.name === 'b2b_potential')?.explanation ?? '', /advertised as employment, not ruled out/);
    }
  });
}

test('s01: the public contacts were read on the page, and the next step names the person', async () => {
  const scenario = scenarios[0] as Scenario;
  const { doc } = await runOne([scenario.signal]);
  const lead = doc.leads[0];
  assert.deepEqual(lead?.contacts.map((contact) => contact.value).sort(), ['engineering@lindenwerk.test', 'https://lindenwerk.test/team']);
  assert.ok(lead?.contacts.every((contact) => contact.verified && contact.quote.length > 8 && contact.source_url.startsWith('https://lindenwerk.test/')));
  assert.match(lead?.next_action ?? '', /Write to Katrin Vogel \(CTO\)/);
  assert.ok(lead?.facts.some((fact) => fact.field === 'company_size' && fact.provenance === 'verified'));
});

test('all scenarios together: nine qualify, the two irrelevant ones do not, and the best come first', async () => {
  const { doc } = await runOne(scenarios.map((scenario) => scenario.signal));
  const qualified = doc.leads.filter((lead) => lead.qualified);
  assert.equal(qualified.length, 9, qualified.map((lead) => lead.company_name).join(', '));
  assert.deepEqual(doc.leads.map((lead) => lead.qualified), [...doc.leads.map((lead) => lead.qualified)].sort((a, b) => Number(b) - Number(a)));
  const scores = qualified.map((lead) => lead.score.total);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(!doc.leads.some((lead) => lead.company_name === 'Gradient Studios'));
  assert.equal(doc.run.metrics.qualified, 9);
});
