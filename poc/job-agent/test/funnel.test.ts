// Tests for the daily funnel: the layer that must be explainable, offline and free.
// Every rule is asserted from both sides, including the boundaries it names.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyHardFilters,
  detectContract,
  detectCountry,
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

test('country: a recognised foreign location is dropped, an unreadable one is kept', () => {
  const italian = make({ id: 'it', location: 'Milano, Italia' });
  const german = make({ id: 'de', location: 'Berlin, Deutschland' });
  const unknown = make({ id: 'xx', location: 'Anywhere' });
  const result = applyHardFilters([italian, german, unknown], spec({ countries: ['IT'] }), new Set(), NOW);

  assert.deepEqual(result.kept.map(postingKey), ['remoteok:it', 'remoteok:xx']);
  assert.equal(result.dropped[0]?.reason, 'country');
  assert.match(result.dropped[0]?.detail ?? '', /DE/);
  assert.equal(result.unknown_country, 1, 'an unrecognised place is counted, never guessed');
});

test('country detection reads names, not codes', () => {
  assert.equal(detectCountry('Milano, Italia'), 'IT');
  assert.equal(detectCountry('Remote - Europe'), null);
  assert.equal(detectCountry(''), null);
  assert.equal(detectCountry('Indianapolis, Indiana'), null, 'a word must not match inside another');
});

test('onsite city: a non-remote posting outside the reachable cities is dropped', () => {
  const milan = make({ id: 'mi', location: 'Milano, Italia', remote_hint: false });
  const rome = make({ id: 'rm', location: 'Roma, Italia', remote_hint: false });
  const result = applyHardFilters(
    [milan, rome],
    spec({ remote_modes: ['remote', 'onsite'], onsite_cities: ['Milano'], countries: [] }),
    new Set(),
    NOW,
  );

  assert.deepEqual(result.kept.map(postingKey), ['remoteok:mi']);
  assert.equal(result.dropped[0]?.reason, 'onsite_city');
});

test('onsite city: a remote posting is not judged by city at all', () => {
  const remote = make({ id: 'r', location: 'Roma, Italia', remote_hint: true });
  const result = applyHardFilters(
    [remote],
    spec({ remote_modes: ['remote', 'onsite'], onsite_cities: ['Milano'], countries: [] }),
    new Set(),
    NOW,
  );
  assert.equal(result.kept.length, 1);
});

test('contract: a stated shape the profile rejects is dropped, an unstated one is kept', () => {
  const freelance = make({ id: 'f', description: 'Freelance, partita IVA, 6 months' });
  const employee = make({ id: 'e', description: 'Full-time permanent position' });
  const silent = make({ id: 's', description: 'We build desktop apps' });
  const result = applyHardFilters(
    [freelance, employee, silent],
    spec({ contract_types: ['freelance'] }),
    new Set(),
    NOW,
  );

  assert.deepEqual(result.kept.map(postingKey), ['remoteok:f', 'remoteok:s']);
  assert.equal(result.dropped[0]?.reason, 'contract_type');
  assert.equal(result.unknown_contract, 1);
});

test('contract detection needs a marker, and both markers cancel out', () => {
  assert.equal(detectContract('Freelance, partita IVA'), 'freelance');
  assert.equal(detectContract('Full-time permanent role'), 'employee');
  assert.equal(detectContract('We build things'), null);
  assert.equal(detectContract('Freelance or full-time, you choose'), null, 'both markers are ambiguous');
});

test('contract: an empty preference list is no constraint, not "reject everything"', () => {
  const base = spec();
  const noPreference = { ...base, hard: { ...base.hard, contract_types: [] } };
  const employee = make({ id: 'e', description: 'Full-time permanent position' });
  const freelance = make({ id: 'f', description: 'Freelance, partita IVA' });

  const result = applyHardFilters([employee, freelance], noPreference, new Set(), NOW);

  assert.deepEqual(result.kept.map(postingKey), ['remoteok:e', 'remoteok:f']);
  assert.equal(result.dropped.length, 0);
});

// --- Unknown facts are routed to verification, never read as true ---------------

test('a kept posting with an unknown fact is routed to verification, naming the fact', () => {
  const unknown = make({ id: 'xx', location: 'Anywhere', description: 'We build desktop apps with Rust and Python.' });
  const result = applyHardFilters([unknown], spec({ countries: ['IT'], contract_types: ['freelance'] }), new Set(), NOW);

  assert.deepEqual(result.kept.map(postingKey), ['remoteok:xx'], 'an unknown fact never drops the posting');
  assert.equal(result.needs_verification.length, 1);
  assert.equal(result.needs_verification[0]?.posting.id, 'xx');
  assert.deepEqual(result.needs_verification[0]?.unknown, ['country', 'contract']);
});

test('a posting whose checked facts are all known is not routed to verification', () => {
  const known = make({
    id: 'ok',
    location: 'Milano, Italia',
    description: 'Partita IVA freelance con Rust e Python per il team.',
  });
  const result = applyHardFilters([known], spec({ countries: ['IT'], contract_types: ['freelance'] }), new Set(), NOW);

  assert.deepEqual(result.kept.map(postingKey), ['remoteok:ok']);
  assert.deepEqual(result.needs_verification, [], 'a known fact needs no verification');
});

test('an unknown fact is counted in the funnel and listed per posting, not guessed', () => {
  const unknown = make({ id: 'xx', location: 'Anywhere', description: 'We build desktop apps with Rust and Python.' });
  const result = applyHardFilters([unknown], spec({ countries: ['IT'], contract_types: ['freelance'] }), new Set(), NOW);

  assert.equal(result.unknown_country, 1);
  assert.equal(result.unknown_contract, 1);
});

test('a dropped posting is never also routed to verification', () => {
  const german = make({ id: 'de', location: 'Berlin, Deutschland' });
  const result = applyHardFilters([german], spec({ countries: ['IT'] }), new Set(), NOW);

  assert.equal(result.dropped[0]?.reason, 'country');
  assert.deepEqual(result.needs_verification, []);
});

// --- Review fixes: range tops and accented country names --------------------------

test('salary: a range whose top meets the floor is kept, not judged by its bottom', () => {
  const range = make({ id: 'r', salary: '90k - 120k USD' });
  const result = applyHardFilters(
    [range],
    spec({ min_salary: { amount: 100000, currency: 'USD', period: 'year' } }),
    new Set(),
    NOW,
  );
  assert.deepEqual(result.kept.map(postingKey), ['remoteok:r']);
});

test('salary: a range whose top is below the floor is dropped', () => {
  const range = make({ id: 'r', salary: '80k - 90k USD' });
  const result = applyHardFilters(
    [range],
    spec({ min_salary: { amount: 100000, currency: 'USD', period: 'year' } }),
    new Set(),
    NOW,
  );
  assert.equal(result.dropped[0]?.reason, 'salary_below_floor');
});

test('country: an accented name is recognised as a whole word', () => {
  assert.equal(detectCountry('Wien, Österreich'), 'AT');
  assert.equal(detectCountry('Vienna, Austria'), 'AT');
});

test('a malformed publish date is kept, counted as unknown and routed to verification', () => {
  const broken = make({ id: 'bd', published_at: 'not-a-date' });
  const result = applyHardFilters([broken], spec(), new Set(), NOW);

  assert.deepEqual(result.kept.map(postingKey), ['remoteok:bd']);
  assert.equal(result.unknown_date, 1, 'an unreadable date is unknown, not fresh');
  assert.ok(result.needs_verification[0]?.unknown.includes('date'), 'the date is listed for verification');
});

test('an unknown fact is counted only when its posting is kept, not when it is later dropped', () => {
  const dropped = make({ id: 'dl', published_at: null, description: 'We build desktop apps with Rust and Python for the team.' });
  const result = applyHardFilters([dropped], spec({ languages: ['it'] }), new Set(), NOW);

  assert.equal(result.dropped[0]?.reason, 'language', 'the posting is dropped for language');
  assert.equal(result.unknown_date, 0, 'a dropped posting leaves no unknown behind in the evidence');
});
