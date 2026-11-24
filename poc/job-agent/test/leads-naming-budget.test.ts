// Naming companies costs a request per twelve signals, and a subscription program takes seconds per request:
// it is asked only about signals the free filters keep, and never about more than a limit.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FetchLike } from '../src/jev.ts';
import { identifyCompanies } from '../src/leads/identify.ts';
import { prefilter } from '../src/leads/prefilter.ts';
import { defaultStrategy } from '../src/leads/strategy.ts';
import type { Signal } from '../src/leads/types.ts';
import { profile } from './support.ts';

const signal = (id: string, title: string): Signal => ({
  id, type: 'job_posting', source: 'hn-hiring', sources: ['hn-hiring'], url: `https://example.test/${id}`, title, text: 'Remote, senior role.', company_name: null,
  location: null, remote_hint: null, salary: null, published_at: null, observed_at: '2026-11-24T00:00:00Z',
});

const model = (): { prompts: string[]; deps: Parameters<typeof identifyCompanies>[1] } => {
  const prompts: string[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    prompts.push(String((JSON.parse(init.body ?? '{}') as { messages: Array<{ content: string }> }).messages[0]?.content));
    return { status: 200, text: JSON.stringify({ content: [{ type: 'text', text: '[]' }], usage: { input_tokens: 10, output_tokens: 2 }, stop_reason: 'end_turn' }) };
  };
  return { prompts, deps: { apiKey: 'k', provider: 'anthropic', model: 'm', maxTokens: 100, fetchImpl } };
};

const now = new Date('2026-11-24T12:00:00Z');
const strategy = defaultStrategy(profile);

test('a signal a free filter drops is never sent for naming, and the skip is counted', async () => {
  const junior = signal('junior', 'Junior developer wanted');
  const senior = signal('senior', 'Senior Laravel engineer wanted at Acme');
  const only = (candidate: Signal): boolean => prefilter([candidate], strategy, now).kept.length > 0;
  assert.equal(only(junior), false, 'the fixture is dropped by the free filters');
  assert.equal(only(senior), true);
  const { prompts, deps } = model();
  const result = await identifyCompanies([junior, senior], deps, { only });
  assert.equal(prompts.length, 1);
  assert.ok(!prompts[0]?.includes('Junior developer'));
  assert.ok(prompts[0]?.includes('Senior Laravel'));
  assert.equal(result.skipped, 1);
});

test('no more signals than the limit are asked about, in the order they came', async () => {
  const signals = Array.from({ length: 30 }, (_, index) => signal(`s${index}`, `Senior engineer number ${index}`));
  const { prompts, deps } = model();
  const result = await identifyCompanies(signals, deps, { limit: 12 });
  assert.equal(prompts.length, 1, 'twelve fit in one request');
  assert.ok(prompts[0]?.includes('number 11') && !prompts[0]?.includes('number 12'));
  assert.equal(result.skipped, 18);
});

test('without options every unnamed signal is asked about, as before', async () => {
  const signals = Array.from({ length: 30 }, (_, index) => signal(`s${index}`, `Senior engineer number ${index}`));
  const { prompts, deps } = model();
  const result = await identifyCompanies(signals, deps);
  assert.equal(prompts.length, 3);
  assert.equal(result.skipped, 0);
});
