// A selected posting carries its description into the evidence, so the report can read the
// posting it was judged on. Offline: the network is a fake fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultConfig } from '../src/config.ts';
import type { FetchLike } from '../src/jev.ts';
import { compileProfile, parseProfile } from '../src/profile.ts';
import { runOnce, type RunDeps } from '../src/run.ts';
import { MAX_DESCRIPTION_CHARS } from '../src/report.ts';

const NOW = new Date('2026-11-08T12:00:00Z');

const profile = (() => {
  const result = parseProfile({
    headline: 'Backend developer',
    capabilities: ['desktop app'],
    domains: [],
    seniority: 'senior',
    years_experience: 12,
    remote_modes: ['remote'],
    onsite_cities: [],
    countries: [],
    contract_types: ['freelance'],
    languages: ['en'],
    min_salary: null,
    exclude_companies: [],
    exclude_terms: [],
    accepted_gaps: [],
    cv: 'Rust and Python with coding agents.',
    portfolio: null,
    threshold: 0.9,
    daily_cap: 2,
  });
  if (!result.ok) throw new Error(result.error);
  return result.profile;
})();

const DESCRIPTION = 'We build desktop apps with Rust for the whole team.';
const FEED = JSON.stringify([
  { last_updated: 1794096003, legal: 'terms' },
  {
    id: 1,
    position: 'Senior Rust Engineer',
    company: 'Acme',
    location: 'Remote',
    url: 'https://example.test/1',
    date: 1794000000,
    description: DESCRIPTION,
  },
]);

const JUDGEMENT = JSON.stringify({
  model: 'jev-latest',
  answers: {
    fit: {
      type: 'choice',
      choice: 'yes',
      confidence: 0.9,
      probabilities: { yes: 0.95, yes_with_gap: 0, gap_not_accepted: 0, no: 0.05 },
    },
    stack_stance: {
      type: 'choice',
      choice: 'not_specified',
      confidence: 0.8,
      probabilities: { not_specified: 0.8, preferred: 0.2 },
    },
  },
  usage: { input_tokens: 150, output_tokens: 20 },
});

const runWith = (feed: string) => {
  const fetchImpl = (async (url: string) =>
    url.startsWith('https://remoteok.com')
      ? { status: 200, text: feed }
      : { status: 200, text: JUDGEMENT }) as FetchLike;
  const deps: RunDeps = {
    config: defaultConfig(),
    spec: compileProfile(profile),
    queries: { list: ['desktop app'], source: 'fallback', reason: null },
    sources: ['remoteok'],
    fetchImpl,
    jev: { apiKey: 'test-key', fetchImpl },
    now: NOW,
    seen: new Set<string>(),
    sleep: async () => undefined,
  };
  return runOnce(deps);
};

test('a selected posting keeps its description in the evidence for the report', async () => {
  const evidence = await runWith(FEED);
  assert.equal(evidence.selected.length, 1);
  assert.equal(evidence.selected[0]?.description, DESCRIPTION);
});

test('a description longer than the report bound is cut to it in the evidence', async () => {
  // Realistic English, so the language filter keeps it; gibberish is dropped there, correctly.
  const long = 'We build desktop apps with Rust for the whole team. '.repeat(Math.ceil((MAX_DESCRIPTION_CHARS + 500) / 50));
  const feed = JSON.stringify([
    { last_updated: 1794096003, legal: 'terms' },
    {
      id: 1,
      position: 'Senior Rust Engineer',
      company: 'Acme',
      location: 'Remote',
      url: 'https://example.test/1',
      date: 1794000000,
      description: long,
    },
  ]);
  const evidence = await runWith(feed);
  assert.equal(evidence.selected[0]?.description?.length, MAX_DESCRIPTION_CHARS);
});
