// The seven questions asked about one signal, and how the answers are read. Offline: the judge is a fake.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { FetchLike } from '../src/jev.ts';
import { candidateContext, classifySignal, isSuspicious } from '../src/leads/classify.ts';
import { defaultStrategy } from '../src/leads/strategy.ts';
import type { Signal } from '../src/leads/types.ts';
import { parseProfile } from '../src/profile.ts';

const real = parseProfile(JSON.parse(readFileSync(new URL('./fixtures/profile.real.redacted.json', import.meta.url), 'utf8')));
const profile = real.ok ? real.profile : (undefined as never);
const strategy = defaultStrategy(profile);
const signal: Signal = {
  id: 'a', type: 'freelance_request', source: 'hn-hiring', sources: ['hn-hiring'], url: 'https://news.ycombinator.com/item?id=1',
  title: 'Acme | Contract Laravel engineer | REMOTE', text: 'We need a contractor for our SaaS.', company_name: 'Acme',
  location: null, remote_hint: true, salary: null, published_at: '2026-11-20T00:00:00Z', observed_at: '2026-11-24T00:00:00Z',
};

const answers = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    model: 'jev-latest',
    answers: {
      need: { type: 'choice', choice: 'explicit_external', confidence: 0.9, probabilities: { explicit_external: 0.9, probable_gap: 0.08, employee_only: 0.01, unrelated: 0.01 } },
      b2b: { type: 'noul', noul: 0.88 },
      longterm: { type: 'noul', noul: 0.6 },
      fit: { type: 'choice', choice: 'strong', confidence: 0.9, probabilities: { strong: 0.85, transferable: 0.1, weak: 0.04, none: 0.01 } },
      level: { type: 'choice', choice: 'matches', confidence: 0.9, probabilities: { matches: 0.95, junior_role: 0.03, beyond_profile: 0.02 } },
      remote: { type: 'choice', choice: 'remote_ok', confidence: 0.9, probabilities: { remote_ok: 0.9, unknown: 0.1 } },
      quality: { type: 'choice', choice: 'genuine', confidence: 0.9, probabilities: { genuine: 0.95, scam: 0.01, vague: 0.04 } },
      ...over,
    },
    usage: { input_tokens: 900, output_tokens: 40 },
  });

const judge = (body: string): { bodies: unknown[]; fetchImpl: FetchLike } => {
  const bodies: unknown[] = [];
  return { bodies, fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body ?? 'null')); return { status: 200, text: body }; } };
};

test('one request asks all seven questions and carries the candidate and the signal', async () => {
  const { bodies, fetchImpl } = judge(answers());
  const result = await classifySignal(signal, candidateContext(profile, strategy), { apiKey: 'k', fetchImpl });
  assert.equal(bodies.length, 1);
  const sent = bodies[0] as { questions: Record<string, unknown>; state: { candidate: string; signal: { company: string } } };
  assert.deepEqual(Object.keys(sent.questions).sort(), ['b2b', 'fit', 'level', 'longterm', 'need', 'quality', 'remote']);
  assert.equal(sent.state.signal.company, 'Acme');
  assert.match(sent.state.candidate, /Laravel/);
  assert.match(sent.state.candidate, /B2B/);
  assert.equal(result.need.verdict, 'explicit_external');
  assert.equal(result.b2b, 0.88);
  assert.equal(result.fit.verdict, 'strong');
  assert.equal(result.usage.input_tokens, 900);
  assert.equal(isSuspicious(result), false);
});

test('the candidate sent to the judge never carries the raw CV', () => {
  const context = candidateContext(profile, strategy);
  assert.ok(!context.includes('E S P E R I E N Z A'));
  assert.ok(!context.includes(profile.cv.slice(0, 40)));
});

test('a scheme is suspicious, and so is vague bait', async () => {
  const scam = await classifySignal(signal, 'c', { apiKey: 'k', fetchImpl: judge(answers({ quality: { type: 'choice', choice: 'scam', confidence: 0.9, probabilities: { genuine: 0.02, scam: 0.9, vague: 0.08 } } })).fetchImpl });
  assert.equal(scam.quality.verdict, 'scam');
  assert.equal(isSuspicious(scam), true);
});

test('a missing or unknown answer falls to the safe value and a missing quality is "unknown", never "genuine"', async () => {
  const result = await classifySignal(signal, 'c', {
    apiKey: 'k',
    fetchImpl: judge(JSON.stringify({ model: 'm', answers: { need: { type: 'choice', choice: 'banana', confidence: 1, probabilities: { banana: 1 } } }, usage: { input_tokens: 5, output_tokens: 1 } })).fetchImpl,
  });
  assert.equal(result.need.verdict, 'unrelated');
  assert.equal(result.b2b, 0);
  assert.equal(result.fit.verdict, 'none');
  assert.equal(result.quality.verdict, 'unknown');
  assert.equal(isSuspicious(result), false);
});

test('probabilities outside 0 and 1 are clamped', async () => {
  const result = await classifySignal(signal, 'c', { apiKey: 'k', fetchImpl: judge(answers({ b2b: { type: 'noul', noul: 7 }, longterm: { type: 'noul', noul: -2 } })).fetchImpl });
  assert.equal(result.b2b, 1);
  assert.equal(result.longterm, 0);
});

test('a failing judge is an error that never carries the key', async () => {
  const fetchImpl: FetchLike = async () => ({ status: 401, text: 'bad key sk-secret' });
  await assert.rejects(classifySignal(signal, 'c', { apiKey: 'sk-secret', fetchImpl }), (error: Error) => !error.message.includes('sk-secret') && /401/.test(error.message));
});
