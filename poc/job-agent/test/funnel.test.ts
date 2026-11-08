// Tests for the daily funnel: the layer that must be explainable, offline and free.
// Every rule is asserted from both sides, including the boundaries it names.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyHardFilters,
  detectLanguage,
  parseSalary,
  postingKey,
  rankAndCap,
} from '../src/funnel.ts';
import { compileProfile, parseProfile } from '../src/profile.ts';
import type { Posting } from '../src/sources/types.ts';

const NOW = new Date('2026-11-08T12:00:00Z');

const base: Posting = {
  source: 'remoteok',
  id: '1',
  title: 'Senior Rust Engineer',
  company: 'Acme',
  location: 'Remote',
  url: 'https://example.test/1',
  remote_hint: true,
  description: 'We build desktop apps with Rust and Python. The team works remotely.',
  published_at: '2026-11-06T00:00:00Z',
  salary: null,
};

const make = (patch: Partial<Posting>): Posting => ({ ...base, ...patch });

const spec = (patch: Record<string, unknown> = {}) => {
  const profile = parseProfile({
    headline: 'Developer',
    capabilities: ['desktop app'],
    domains: [],
    seniority: 'senior',
    years_experience: 10,
    remote_modes: ['remote'],
    onsite_cities: [],
    countries: [],
    contract_types: ['freelance'],
    languages: ['it', 'en'],
    min_salary: null,
    exclude_companies: ['Badcorp'],
    exclude_terms: ['gambling'],
    accepted_gaps: [],
    cv: 'Rust and Python apps with coding agents.',
    portfolio: null,
    threshold: 0.9,
    daily_cap: 2,
    ...patch,
  });
  if (!profile.ok) throw new Error(profile.error);
  return compileProfile(profile.profile, { maxAgeDays: 14 });
};

test('the key is stable across runs and unique per source', () => {
  assert.equal(postingKey(base), 'remoteok:1');
  assert.equal(postingKey(make({ id: '2' })), 'remoteok:2');
});

test('language detection is offline and returns null when unsure', () => {
  assert.equal(detectLanguage('Sviluppiamo applicazioni desktop per il team, con esperienza'), 'it');
  assert.equal(detectLanguage('We build desktop apps for the team, with experience'), 'en');
  assert.equal(detectLanguage('Wir bauen Anwendungen mit Erfahrung für das Team und sind'), 'de');
  assert.equal(detectLanguage('Buscamos desarrolladores con experiencia para la empresa'), 'es');
  assert.equal(detectLanguage('Rust'), null, 'too short to guess');
});

test('a fresh posting in an accepted language survives every filter', () => {
  const result = applyHardFilters([base], spec(), new Set(), NOW);
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped.length, 0);
});

test('a posting already shown is dropped with the reason', () => {
  const result = applyHardFilters([base], spec(), new Set(['remoteok:1']), NOW);
  assert.equal(result.kept.length, 0);
  assert.equal(result.dropped[0]?.reason, 'already_seen');
});

test('freshness: the boundary day is kept, one day past it is not', () => {
  const atLimit = make({ published_at: '2026-10-25T12:00:00Z' });
  const past = make({ id: '2', published_at: '2026-10-25T11:00:00Z' });
  const result = applyHardFilters([atLimit, past], spec(), new Set(), NOW);
  assert.deepEqual(result.kept.map(postingKey), ['remoteok:1']);
  assert.equal(result.dropped[0]?.reason, 'stale');
});

test('an undated posting is kept and counted, never guessed stale', () => {
  const result = applyHardFilters([make({ published_at: null })], spec(), new Set(), NOW);
  assert.equal(result.kept.length, 1);
  assert.equal(result.unknown_date, 1);
});

test('a language the profile does not work in is dropped', () => {
  const german = make({
    id: '3',
    title: 'Backend Entwickler',
    description: 'Wir bauen Anwendungen mit Erfahrung für das Team und sind eine Firma',
  });
  const result = applyHardFilters([german], spec(), new Set(), NOW);
  assert.equal(result.dropped[0]?.reason, 'language');
  assert.match(result.dropped[0]?.detail ?? '', /de/);
});

test('an empty language list disables the language filter entirely', () => {
  const result = applyHardFilters([make({ id: '3', description: null, title: 'x' })], spec({ languages: [] }), new Set(), NOW);
  assert.equal(result.kept.length, 1);
});

test('remote-only drops a posting that says onsite, and keeps an unknown', () => {
  const onsite = make({ id: '4', remote_hint: false });
  const unknown = make({ id: '5', remote_hint: null });
  const result = applyHardFilters([onsite, unknown], spec(), new Set(), NOW);
  assert.deepEqual(result.kept.map(postingKey), ['remoteok:5']);
  assert.equal(result.dropped[0]?.reason, 'remote_mode');
  assert.equal(result.unknown_remote, 1);
});

test('accepting hybrid or onsite disables the remote filter', () => {
  const result = applyHardFilters([make({ remote_hint: false })], spec({ remote_modes: ['remote', 'hybrid'] }), new Set(), NOW);
  assert.equal(result.kept.length, 1);
});

test('an excluded company or term is dropped case-insensitively', () => {
  const company = make({ id: '6', company: 'bAdCoRp SpA' });
  const term = make({ id: '7', title: 'Engineer', description: 'Our Gambling platform' });
  const result = applyHardFilters([company, term], spec(), new Set(), NOW);
  assert.equal(result.kept.length, 0);
  assert.deepEqual(result.dropped.map((drop) => drop.reason), ['excluded_company', 'excluded_term']);
});

test('salary: a published figure below the floor is dropped, an unreadable one is kept', () => {
  const low = make({ id: '8', salary: '200 EUR/day' });
  const unreadable = make({ id: '9', salary: 'competitive' });
  const otherCurrency = make({ id: '10', salary: '400 USD/day' });
  const result = applyHardFilters(
    [low, unreadable, otherCurrency],
    spec({ min_salary: { amount: 600, currency: 'EUR', period: 'day' } }),
    new Set(),
    NOW,
  );
  assert.deepEqual(result.kept.map(postingKey), ['remoteok:9', 'remoteok:10']);
  assert.equal(result.dropped[0]?.reason, 'salary_below_floor');
});

test('salary parsing reads the shapes the feeds publish', () => {
  assert.deepEqual(parseSalary('90000-120000 USD'), { amount: 90000, currency: 'USD', period: 'year' });
  assert.deepEqual(parseSalary('$90k - $110k'), { amount: 90000, currency: 'USD', period: 'year' });
  assert.deepEqual(parseSalary('600 EUR/day'), { amount: 600, currency: 'EUR', period: 'day' });
  assert.equal(parseSalary('competitive'), null);
});

test('ranking keeps what clears the threshold, best first, capped', () => {
  const scored = [
    { posting: make({ id: 'a' }), probability: 0.92 },
    { posting: make({ id: 'b' }), probability: 0.97 },
    { posting: make({ id: 'c' }), probability: 0.89 },
    { posting: make({ id: 'd' }), probability: 0.95 },
  ];
  const result = rankAndCap(scored, 0.9, 2);
  assert.deepEqual(result.selected.map((item) => item.posting.id), ['b', 'd']);
  assert.deepEqual(result.overflow.map((item) => item.posting.id), ['a']);
  assert.equal(result.below_threshold, 1, 'the 0.89 posting is counted, not hidden');
});

test('the threshold is inclusive at the boundary and a quiet day selects nothing', () => {
  const exact = [{ posting: make({ id: 'a' }), probability: 0.9 }];
  assert.equal(rankAndCap(exact, 0.9, 2).selected.length, 1);
  const quiet = [{ posting: make({ id: 'b' }), probability: 0.5 }];
  const result = rankAndCap(quiet, 0.9, 2);
  assert.equal(result.selected.length, 0);
  assert.equal(result.below_threshold, 1);
});
