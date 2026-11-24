// Identification of unnamed signals and the outreach draft. Offline: the model is a fake.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FetchLike } from '../src/jev.ts';
import { identifyCompanies } from '../src/leads/identify.ts';
import { checkDraft, draftOutreach, draftPrompt, languageFor, type DraftInput } from '../src/leads/outreach.ts';
import { defaultStrategy } from '../src/leads/strategy.ts';
import type { Fact, Signal } from '../src/leads/types.ts';
import { profile } from './support.ts';

const signal = (id: string, title: string, over: Partial<Signal> = {}): Signal => ({
  id, type: 'funding', source: 'sifted', sources: ['sifted'], url: `https://sifted.eu/${id}`, title, text: null, company_name: null,
  location: null, remote_hint: null, salary: null, published_at: null, observed_at: '2026-11-24T00:00:00Z', ...over,
});

const model = (text: string): { prompts: string[]; deps: Parameters<typeof identifyCompanies>[1] } => {
  const prompts: string[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    prompts.push(String((JSON.parse(init.body ?? '{}') as { messages: Array<{ content: string }> }).messages[0]?.content));
    return { status: 200, text: JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 300, output_tokens: 50 }, stop_reason: 'end_turn' }) };
  };
  return { prompts, deps: { apiKey: 'k', provider: 'anthropic', model: 'claude-sonnet-5-5', maxTokens: 1000, fetchImpl } };
};

test('a company is named only when the signal text itself names it', async () => {
  const signals = [signal('a', 'Defence startup Agon raises $70m'), signal('b', 'Seed round closes for a stealth AI team'), signal('c', 'Spend platform Payhawk announces raise', { company_name: 'Payhawk' })];
  const { prompts, deps } = model(JSON.stringify([
    { id: 'a', company: 'Agon', quote: 'startup Agon raises' },
    { id: 'b', company: 'Mystery Labs', quote: 'a stealth AI team' },
  ]));
  const result = await identifyCompanies(signals, deps);
  assert.equal(result.signals[0]?.company_name, 'Agon');
  assert.equal(result.signals[1]?.company_name, null, 'a name that is not in the text is never accepted');
  assert.equal(result.signals[2]?.company_name, 'Payhawk', 'a named signal is not asked about');
  assert.equal(result.identified, 1);
  assert.equal(prompts.length, 1);
  assert.ok(!prompts[0]?.includes('Payhawk'));
  assert.deepEqual(result.usage, { input_tokens: 300, output_tokens: 50 });
});

test('a model that fails leaves the signals unnamed and says why', async () => {
  const fetchImpl: FetchLike = async () => ({ status: 401, text: 'no' });
  const result = await identifyCompanies([signal('a', 'Agon raises')], { apiKey: 'k', provider: 'anthropic', model: 'm', maxTokens: 100, fetchImpl });
  assert.equal(result.identified, 0);
  assert.match(result.failure ?? '', /key was refused/);
});

const strategy = defaultStrategy(profile);
const facts: Fact[] = [
  { field: 'funding', value: 'EUR 8 million Series A', provenance: 'reported', source_url: 'https://news.test/a', quote: 'raised 8 million euros' },
  { field: 'growth', value: 'doubling', provenance: 'inferred', source_url: null, quote: null },
];
const input: DraftInput = {
  company: 'Acme', website: 'https://acme.test', lang: 'en', facts, signals: [signal('s', 'Acme | Contract Laravel engineer | REMOTE', { type: 'freelance_request' })],
  contact: null, need: 'Fresh Series A and an open contract role.', profile, strategy,
};
const good = { subject: 'Laravel capacity after your Series A', body: 'Hello Acme team, I saw you raised a EUR 8 million Series A and are looking for a contract Laravel engineer. With 12 years building SaaS back ends and Vue front ends I can take on a defined part of the roadmap. Would a short call next week help?\n[Your name]', facts_used: ['funding'] };

test('the prompt carries only evidence-backed facts and forbids links and invented numbers', () => {
  const prompt = draftPrompt(input);
  assert.match(prompt, /EUR 8 million Series A/);
  assert.ok(!prompt.includes('doubling'), 'the model own reading is not given back to it as a fact');
  assert.match(prompt, /No links/);
  assert.match(prompt, /not in the facts or the signals/);
});

test('a draft that rests on evidence and signs with the placeholder stands', () => {
  assert.equal(checkDraft(good, input), null);
});

test('a number, a link or a fact that is not in the evidence is refused', () => {
  assert.match(checkDraft({ ...good, body: good.body.replace('8 million', '80 million') }, input) ?? '', /number that is not in the evidence: 80/);
  assert.match(checkDraft({ ...good, body: good.body + ' See https://x.test' }, input) ?? '', /link/);
  assert.match(checkDraft({ ...good, facts_used: ['revenue'] }, input) ?? '', /no evidence/);
  assert.match(checkDraft({ ...good, facts_used: ['growth'] }, input) ?? '', /no evidence/, 'an inference is not a fact to cite');
  assert.match(checkDraft({ ...good, body: good.body.replace('[Your name]', 'Alessandro') }, input) ?? '', /signature placeholder/);
});

test('the engineer own years of experience are allowed, and no other number is invented', () => {
  assert.equal(checkDraft({ ...good, body: good.body.replace('12 years', '12 years') }, input), null);
  assert.match(checkDraft({ ...good, body: good.body.replace('12 years', '25 years') }, input) ?? '', /25/);
});

test('a good draft is returned with its facts, a refused one with its reason, and a failing model with the provider reason', async () => {
  const ok = await draftOutreach(input, model(JSON.stringify(good)).deps);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.draft.fact_ids, ['funding']);
    assert.equal(ok.draft.lang, 'en');
    assert.equal(ok.usage.input_tokens, 300);
  }
  const bad = await draftOutreach(input, model(JSON.stringify({ ...good, body: good.body.replace('8 million', '80 million') })).deps);
  assert.deepEqual(bad.ok, false);
  const down = await draftOutreach(input, { apiKey: 'k', provider: 'anthropic', model: 'm', maxTokens: 100, fetchImpl: async () => ({ status: 429, text: '' }) });
  assert.equal(down.ok, false);
});

test('the language follows the market the user works in, and falls back to English', () => {
  assert.equal(languageFor('DE', ['en', 'it', 'es']), 'en');
  assert.equal(languageFor('IT', ['en', 'it', 'es']), 'it');
  assert.equal(languageFor('ES', ['en', 'it', 'es']), 'es');
  assert.equal(languageFor(null, ['en', 'it', 'es']), 'en');
  assert.equal(languageFor('IT', ['en']), 'en', 'a language the user did not choose is never used');
});

test('nothing in the outreach module can send: it has no recipient address and no send path', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('../src/leads/outreach.ts', import.meta.url), 'utf8');
  assert.ok(!/smtp|sendmail|nodemailer|mailto:|\.send\(/i.test(source));
});
