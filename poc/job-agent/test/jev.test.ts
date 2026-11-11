// Tests for the judgment layer and the query planner. The HTTP client is injected,
// so nothing here reaches TypeSafe, Anthropic or Qwen, and no key is ever real.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asGap, askSystemOne, scoreFit, stackStance, type FetchLike } from '../src/jev.ts';
import { planQueries, extractQueries } from '../src/planner.ts';
import type { Posting } from '../src/sources/types.ts';
import { DEFAULT_STRENGTHS } from '../src/profile.ts';

const posting: Posting = {
  source: 'remoteok',
  id: '1',
  title: 'Senior Rust Engineer',
  company: 'Acme',
  location: 'Remote',
  url: 'https://example.test/1',
  remote_hint: true,
  description: 'Build desktop apps',
  published_at: '2026-11-06T00:00:00Z',
  salary: null,
};

type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };

const capture = (status: number, body: string): { calls: Call[]; fetchImpl: FetchLike } => {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { status, text: body };
  };
  return { calls, fetchImpl };
};

const CHOICE = (question: string, choice: string, probabilities: Record<string, number>) =>
  JSON.stringify({
    model: 'jev-latest',
    answers: {
      [question]: { type: 'choice', choice, confidence: 0.9, probabilities },
    },
    usage: { input_tokens: 120, output_tokens: 12 },
  });

test('the request carries the bearer key, the model and the questions', async () => {
  const { calls, fetchImpl } = capture(200, CHOICE('stack_stance', 'not_specified', { not_specified: 0.8 }));
  await stackStance(posting, { apiKey: 'test-key', fetchImpl });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call?.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(call?.init.method, 'POST');
  assert.equal(call?.init.headers['authorization'], 'Bearer test-key');
  const body = JSON.parse(call?.init.body ?? '{}');
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.questions.stack_stance.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.stack_stance.criteria).sort(), [
    'not_specified',
    'preferred',
    'required_specific',
    'tool_mentioned',
  ]);
  assert.equal(body.state.posting.title, 'Senior Rust Engineer');
});

test('a non-200 answer throws with the status and never the key', async () => {
  const { fetchImpl } = capture(500, 'boom');
  await assert.rejects(
    () => askSystemOne({ state: 'x', questions: {} }, { apiKey: 'sk-secret-value', fetchImpl }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /500/);
      assert.doesNotMatch(error.message, /sk-secret-value/);
      return true;
    },
  );
});

test('a non-JSON answer is an error, not a silent zero', async () => {
  const { fetchImpl } = capture(200, '<html>oops</html>');
  await assert.rejects(
    () => askSystemOne({ state: 'x', questions: {} }, { apiKey: 'k', fetchImpl }),
    /not JSON/,
  );
});

test('fit probability is P(yes) + P(yes_with_gap), clamped to 1', async () => {
  const { fetchImpl } = capture(
    200,
    CHOICE('fit', 'yes_with_gap', { yes: 0.55, yes_with_gap: 0.4, gap_not_accepted: 0.04, no: 0.01 }),
  );
  const result = await scoreFit(posting, 'candidate context', { apiKey: 'k', fetchImpl });
  assert.equal(result.verdict, 'yes_with_gap');
  assert.ok(Math.abs(result.probability - 0.95) < 1e-9);
  assert.equal(result.usage.input_tokens, 120, 'the cost signal is carried out');
});

test('a fit answer that sums above 1 is clamped instead of exceeding certainty', async () => {
  const { fetchImpl } = capture(200, CHOICE('fit', 'yes', { yes: 0.8, yes_with_gap: 0.4 }));
  const result = await scoreFit(posting, 'ctx', { apiKey: 'k', fetchImpl });
  assert.equal(result.probability, 1);
});

test('a missing answer yields probability 0 with the "no" verdict', async () => {
  const { fetchImpl } = capture(200, JSON.stringify({ answers: {}, usage: {} }));
  const result = await scoreFit(posting, 'ctx', { apiKey: 'k', fetchImpl });
  assert.equal(result.probability, 0);
  assert.equal(result.verdict, 'no');
});

test('the stack stance returns the top choice and its distribution', async () => {
  const { fetchImpl } = capture(
    200,
    CHOICE('stack_stance', 'required_specific', { required_specific: 0.7, not_specified: 0.2, preferred: 0.1 }),
  );
  const result = await stackStance(posting, { apiKey: 'k', fetchImpl });
  assert.equal(result.stance, 'required_specific');
  assert.equal(result.probabilities['required_specific'], 0.7);
});

const profile = {
  headline: 'Backend developer',
  capabilities: ['desktop app', 'API'],
  domains: ['SaaS B2B'],
  seniority: 'senior' as const,
  years_experience: 12,
  remote_modes: ['remote' as const],
  onsite_cities: [],
  countries: [],
  contract_types: ['freelance' as const],
  languages: ['en'],
  min_salary: null,
  timezone_overlap_hours: null,
  exclude_companies: [],
  exclude_terms: [],
  accepted_gaps: [],
  cv: 'Rust and Python with coding agents.',
  portfolio: null,
  threshold: 0.9,
  daily_cap: 2,
  scoring_budget: 120,
  strengths: DEFAULT_STRENGTHS,
};

test('the planner asks Anthropic with the documented headers and parses the answer', async () => {
  const { calls, fetchImpl } = capture(
    200,
    JSON.stringify({
      content: [{ type: 'text', text: '["senior desktop app","api engineer"]' }],
      usage: { input_tokens: 210, output_tokens: 30 },
    }),
  );
  const result = await planQueries(profile, {
    provider: 'anthropic',
    apiKey: 'k',
    model: 'claude-sonnet-4-5',
    fetchImpl,
  });

  assert.deepEqual(result.queries, ['senior desktop app', 'api engineer']);
  assert.equal(result.source, 'model');
  const call = calls[0];
  assert.equal(call?.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call?.init.headers['x-api-key'], 'k');
  assert.equal(call?.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(result.usage.input_tokens, 210);
});

test('the planner asks Qwen on its OpenAI-compatible endpoint', async () => {
  const { calls, fetchImpl } = capture(
    200,
    JSON.stringify({ choices: [{ message: { content: '["rust developer"]' } }], usage: {} }),
  );
  const result = await planQueries(profile, {
    provider: 'qwen',
    apiKey: 'k',
    model: 'qwen3-coder-plus',
    fetchImpl,
  });
  assert.deepEqual(result.queries, ['rust developer']);
  assert.equal(calls[0]?.url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(calls[0]?.init.headers['authorization'], 'Bearer k');
});

test('an unusable model answer falls back to the compiler and says so', async () => {
  const { fetchImpl } = capture(200, JSON.stringify({ content: [{ type: 'text', text: 'sorry, no idea' }] }));
  const result = await planQueries(profile, {
    provider: 'anthropic',
    apiKey: 'k',
    model: 'm',
    fetchImpl,
  });
  assert.equal(result.source, 'fallback');
  assert.match(result.reason ?? '', /no usable query array/);
  assert.ok(result.queries.includes('desktop app'), 'the compiler still produced queries');
});

test('a provider error falls back instead of failing the run', async () => {
  const { fetchImpl } = capture(429, 'slow down');
  const result = await planQueries(profile, { provider: 'qwen', apiKey: 'k', model: 'm', fetchImpl });
  assert.equal(result.source, 'fallback');
  assert.match(result.reason ?? '', /429/);
});

test('the answer parser accepts fences and rejects garbage', () => {
  assert.deepEqual(extractQueries('```json\n["a","b"]\n```', 8), ['a', 'b']);
  assert.equal(extractQueries('no array here', 8), null);
  assert.equal(extractQueries('[1,2,3]', 8), null, 'non-string entries are not queries');
  assert.deepEqual(extractQueries('["a","a","b"]', 8), ['a', 'b'], 'duplicates collapse');
  assert.equal(extractQueries('["a","b","c"]', 2)?.length, 2, 'the limit is honoured');
});

test('the gap parser accepts only the known kinds', () => {
  assert.equal(asGap('stack'), 'stack');
  assert.equal(asGap('seniority'), 'seniority');
  assert.equal(asGap('something else'), 'none');
  assert.equal(asGap(''), 'none');
});
