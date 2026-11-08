// Tests for the profile and the spec it compiles to. The compiler is the boundary
// between "one model call, once" and "the daily loop costs nothing", so every
// derived field is asserted here.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_MAX_AGE_DAYS,
  compileProfile,
  compilePromptContext,
  compileQueries,
  parseProfile,
  type UserProfile,
} from '../src/profile.ts';

const raw = {
  headline: 'Backend and desktop developer',
  capabilities: ['desktop app', 'API', 'data pipeline'],
  domains: ['SaaS B2B'],
  seniority: 'senior',
  years_experience: 12,
  remote_modes: ['remote', 'hybrid'],
  onsite_cities: ['Milano'],
  countries: ['IT'],
  contract_types: ['freelance'],
  languages: ['it', 'en'],
  min_salary: { amount: 600, currency: 'eur', period: 'day' },
  timezone_overlap_hours: 4,
  exclude_companies: ['Acme SpA'],
  exclude_terms: ['gambling'],
  accepted_gaps: ['willing to learn Go'],
  cv: 'Twelve years building things. Rust and Python apps with coding agents.',
  portfolio: 'https://example.test/portfolio',
  threshold: 0.9,
  daily_cap: 2,
};

const parsed = (): UserProfile => {
  const result = parseProfile(raw);
  if (!result.ok) throw new Error(result.error);
  return result.profile;
};

test('a complete profile is accepted and normalised', () => {
  const profile = parsed();
  assert.equal(profile.seniority, 'senior');
  assert.deepEqual(profile.languages, ['it', 'en']);
  assert.equal(profile.min_salary?.currency, 'EUR', 'currency is upper-cased');
  assert.equal(profile.threshold, 0.9);
  assert.equal(profile.daily_cap, 2);
  assert.equal(profile.portfolio, 'https://example.test/portfolio');
});

test('each invalid field is named in the error', () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ headline: '' }, /headline/],
    [{ capabilities: [] }, /capabilities/],
    [{ capabilities: 'desktop app' }, /capabilities/],
    [{ seniority: 'principal' }, /seniority/],
    [{ years_experience: -1 }, /years_experience/],
    [{ remote_modes: ['sometimes'] }, /remote_modes/],
    [{ contract_types: [] }, /contract_types/],
    [{ contract_types: ['internship'] }, /contract_types/],
    [{ cv: '' }, /cv/],
    [{ threshold: 2 }, /threshold/],
    [{ daily_cap: 0 }, /daily_cap/],
    [{ min_salary: { amount: -1, currency: 'EUR', period: 'day' } }, /min_salary\.amount/],
    [{ min_salary: { amount: 10, currency: 'EURO', period: 'day' } }, /min_salary\.currency/],
    [{ min_salary: { amount: 10, currency: 'EUR', period: 'week' } }, /min_salary\.period/],
    [{ accepted_gaps: 'nothing' }, /accepted_gaps/],
  ];
  for (const [patch, expected] of cases) {
    const result = parseProfile({ ...raw, ...patch });
    assert.equal(result.ok, false, `expected ${JSON.stringify(patch)} to be rejected`);
    if (result.ok) continue;
    assert.match(result.error, expected);
    assert.match(result.error, /^profile: /);
  }
});

test('a profile without a salary floor or a portfolio is valid', () => {
  const result = parseProfile({ ...raw, min_salary: null, portfolio: null });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.profile.min_salary, null);
  assert.equal(result.profile.portfolio, null);
});

test('queries come from capability and seniority, never from a language list', () => {
  const queries = compileQueries(parsed());
  assert.ok(queries.includes('desktop app'));
  assert.ok(queries.includes('senior desktop app'));
  assert.ok(queries.includes('senior SaaS B2B'));
  assert.ok(
    queries.every((query) => !/^(rust|go|python|java)$/i.test(query)),
    'no bare language query: stack is a modality, not a gate',
  );
  assert.equal(new Set(queries).size, queries.length, 'queries are unique');
  assert.ok(queries.length <= 8);
});

test('the compiled spec carries the hard filters unchanged', () => {
  const spec = compileProfile(parsed());
  assert.deepEqual(spec.hard.languages, ['it', 'en']);
  assert.deepEqual(spec.hard.remote_modes, ['remote', 'hybrid']);
  assert.deepEqual(spec.hard.exclude_companies, ['acme spa'], 'exclusions are lower-cased');
  assert.deepEqual(spec.hard.exclude_terms, ['gambling']);
  assert.equal(spec.hard.max_age_days, DEFAULT_MAX_AGE_DAYS);
  assert.equal(spec.threshold, 0.9);
  assert.equal(spec.daily_cap, 2);
});

test('the compiled spec is plain data that survives a JSON round trip', () => {
  const spec = compileProfile(parsed());
  assert.deepEqual(JSON.parse(JSON.stringify(spec)), spec);
});

test('the prompt context is compact, labelled and carries the accepted gaps', () => {
  const context = compilePromptContext(parsed());
  assert.match(context, /Headline: Backend and desktop developer/);
  assert.match(context, /Gaps accepted: willing to learn Go/);
  assert.match(context, /Minimum pay: 600 EUR\/day/);
  assert.ok(context.length < 2000, 'the state stays small so a judgment stays cheap');
});

test('an empty profile context says "none declared" instead of hiding it', () => {
  const profile = { ...parsed(), accepted_gaps: [] };
  assert.match(compilePromptContext(profile), /Gaps accepted: none declared/);
});
