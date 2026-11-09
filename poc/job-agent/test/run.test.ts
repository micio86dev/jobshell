// Tests for one full run of the funnel. Every dependency is injected: the feed
// fetch, the judgment fetch and the pacer, so the whole pipeline is exercised
// offline and in milliseconds.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultConfig } from '../src/config.ts';
import type { FetchLike } from '../src/jev.ts';
import { compileProfile, parseProfile } from '../src/profile.ts';
import { runOnce, type RunDeps } from '../src/run.ts';

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

const FEED = JSON.stringify([
  { last_updated: 1794096003, legal: 'terms' },
  {
    id: 1,
    position: 'Senior Rust Engineer',
    company: 'Acme',
    location: 'Remote',
    url: 'https://example.test/1',
    date: 1794000000,
    description: 'We build desktop apps for the team and the product.',
  },
  {
    id: 2,
    position: 'Junior Support',
    company: 'Beta',
    location: 'Remote',
    url: 'https://example.test/2',
    date: 1794000000,
    description: 'We answer tickets for the team and the customers.',
  },
]);

const JUDGEMENT = (yes: number, withGap: number, stance: string): string =>
  JSON.stringify({
    model: 'jev-latest',
    answers: {
      fit: {
        type: 'choice',
        choice: yes >= 0.9 ? 'yes' : 'no',
        confidence: 0.9,
        probabilities: { yes, yes_with_gap: withGap, gap_not_accepted: 0, no: Math.max(0, 1 - yes - withGap) },
      },
      stack_stance: {
        type: 'choice',
        choice: stance,
        confidence: 0.8,
        probabilities: { [stance]: 0.8, not_specified: 0.2 },
      },
    },
    usage: { input_tokens: 150, output_tokens: 20 },
  });

type Init = { method: string; headers: Record<string, string>; body?: string };
type Route = (url: string, init: Init) => { status: number; text: string };

const deps = (route: Route, patch: Partial<RunDeps> = {}): RunDeps => {
  // The feed fetch and the judgment fetch are separate injections, so both must be
  // routed to the fake: forgetting one would send a real request to TypeSafe.
  const fetchImpl = (async (url: string, init: Init) => route(url, init)) as FetchLike;
  return {
  config: defaultConfig(),
  spec: compileProfile(profile),
  queries: { list: ['desktop app'], source: 'fallback', reason: null },
  sources: ['remoteok'],
  fetchImpl,
  jev: { apiKey: 'test-key', fetchImpl },
  now: NOW,
  seen: new Set<string>(),
  sleep: async () => undefined,
  ...patch,
  };
};

test('one run fetches, filters, judges and selects above the threshold', async () => {
  const route: Route = (url) => {
    if (url.startsWith('https://remoteok.com')) return { status: 200, text: FEED };
    return { status: 200, text: JUDGEMENT(0.95, 0.0, 'not_specified') };
  };
  const evidence = await runOnce(deps(route));

  assert.equal(evidence.sources[0]?.postings, 2);
  assert.equal(evidence.funnel.fetched, 2);
  assert.equal(evidence.scoring.judged, 2);
  assert.equal(evidence.selected.length, 2, 'both survive: the fake scores them identically');
  assert.equal(evidence.selected[0]?.verdict, 'yes');
  assert.equal(evidence.selected[0]?.stack_stance, 'not_specified');
  assert.equal(evidence.scoring.input_tokens, 300, 'two judgments, 150 tokens each');
  assert.equal(evidence.queries.source, 'fallback');
});

test('a session-driven source is always refused by the runner', async () => {
  let fetched = 0;
  const route: Route = () => {
    fetched += 1;
    return { status: 200, text: FEED };
  };
  const evidence = await runOnce(deps(route, { sources: ['linkedin'] }));

  assert.equal(fetched, 0, 'the guardrail runs before the network');
  assert.equal(evidence.sources[0]?.policy, 'measurement_only');
  assert.match(evidence.sources[0]?.skipped ?? '', /use the browser extension/);
});

test('a board feed without a tenant is a skip, not a crash', async () => {
  const evidence = await runOnce(deps(() => ({ status: 200, text: FEED }), { sources: ['greenhouse'] }));
  assert.match(evidence.sources[0]?.skipped ?? '', /cannot build a URL: greenhouse: a board feed needs a tenant/);
  assert.equal(evidence.sources[0]?.postings, 0);
});

test('an unknown source is reported as skipped, never fetched', async () => {
  const evidence = await runOnce(deps(() => ({ status: 200, text: FEED }), { sources: ['monster'] }));
  assert.equal(evidence.sources[0]?.skipped, 'no adapter for this source');
});

test('a challenge stops the source and is recorded, never solved', async () => {
  const route: Route = () => ({ status: 200, text: '<div class="captcha">verify you are human</div>' });
  const evidence = await runOnce(deps(route));

  assert.equal(evidence.sources[0]?.challenge, 'captcha');
  assert.match(evidence.sources[0]?.skipped ?? '', /challenge: captcha/);
  assert.equal(evidence.sources[0]?.postings, 0);
  assert.equal(evidence.scoring.judged, 0);
});

test('a non-200 answer stops the source with the status recorded', async () => {
  const evidence = await runOnce(deps(() => ({ status: 429, text: 'slow down' })));
  assert.equal(evidence.sources[0]?.status, 429);
  assert.match(evidence.sources[0]?.skipped ?? '', /status 429/);
});

test('a network error is reported instead of throwing the run away', async () => {
  const evidence = await runOnce(
    deps(() => {
      throw new Error('offline');
    }),
  );
  assert.match(evidence.sources[0]?.skipped ?? '', /fetch failed: offline/);
});

test('the scoring budget caps how many survivors are judged', async () => {
  const route: Route = (url) =>
    url.startsWith('https://remoteok.com')
      ? { status: 200, text: FEED }
      : { status: 200, text: JUDGEMENT(0.95, 0, 'not_specified') };
  const evidence = await runOnce(deps(route, { scoringBudget: 1 }));
  assert.equal(evidence.scoring.judged, 1);
  assert.equal(evidence.scoring.budget, 1);
});

test('the threshold is respected: a low fit selects nothing and says how quiet it was', async () => {
  const route: Route = (url) =>
    url.startsWith('https://remoteok.com')
      ? { status: 200, text: FEED }
      : { status: 200, text: JUDGEMENT(0.2, 0.1, 'required_specific') };
  const evidence = await runOnce(deps(route));
  assert.equal(evidence.selected.length, 0);
  assert.equal(evidence.scoring.below_threshold, 2);
  assert.equal(evidence.scoring.above_threshold, 0);
});

test('postings already shown are dropped before any judgment is paid for', async () => {
  const route: Route = (url) =>
    url.startsWith('https://remoteok.com')
      ? { status: 200, text: FEED }
      : { status: 200, text: JUDGEMENT(0.95, 0, 'not_specified') };
  const evidence = await runOnce(
    deps(route, { seen: new Set(['remoteok:1', 'remoteok:2']) }),
  );
  assert.equal(evidence.funnel.kept, 0);
  assert.equal(evidence.funnel.dropped['already_seen'], 2);
  assert.equal(evidence.scoring.judged, 0, 'no tokens are spent on a posting already seen');
});

test('a source request is a GET with no body, which is what Node fetch requires', async () => {
  const seen: Init[] = [];
  const route: Route = (url, init) => {
    if (url.startsWith('https://remoteok.com')) {
      seen.push(init);
      return { status: 200, text: FEED };
    }
    return { status: 200, text: JUDGEMENT(0.95, 0, 'not_specified') };
  };
  await runOnce(deps(route));

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.method, 'GET');
  assert.equal(seen[0]?.body, undefined, 'a GET with a body is rejected by the real fetch');
  assert.match(seen[0]?.headers['user-agent'] ?? '', /openjob/);
});

test('a URL that does not depend on the query is fetched once, not once per query', async () => {
  let fetches = 0;
  const route: Route = (url) => {
    if (url.startsWith('https://remoteok.com')) {
      fetches += 1;
      return { status: 200, text: FEED };
    }
    return { status: 200, text: JUDGEMENT(0.95, 0, 'not_specified') };
  };
  const evidence = await runOnce(
    deps(route, { queries: { list: ['one', 'two', 'three'], source: 'fallback', reason: null } }),
  );

  assert.equal(fetches, 1, 'the same feed URL is fetched once however many queries produced it');
  assert.equal(evidence.sources[0]?.pages, 1);
});

test('the same posting arriving from a second fetch is judged once', async () => {
  let judged = 0;
  const route: Route = (url) => {
    if (url.startsWith('https://remoteok.com')) return { status: 200, text: FEED };
    judged += 1;
    return { status: 200, text: JUDGEMENT(0.95, 0, 'not_specified') };
  };
  const evidence = await runOnce(deps(route));

  assert.equal(evidence.funnel.fetched, 2, 'two distinct postings in the feed');
  assert.equal(judged, 2, 'each distinct posting is judged once');
});
