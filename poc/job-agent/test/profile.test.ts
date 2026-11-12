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

test('the judge budget defaults to 120 and can be set per profile', () => {
  assert.equal(parsed().scoring_budget, 120, 'a profile that does not say keeps the default');

  const bigger = parseProfile({ ...raw, scoring_budget: 400 });
  assert.equal(bigger.ok, true);
  if (bigger.ok) assert.equal(bigger.profile.scoring_budget, 400);

  for (const bad of [0, -1, 1.5, 'many']) {
    const rejected = parseProfile({ ...raw, scoring_budget: bad });
    assert.equal(rejected.ok, false, `scoring_budget ${String(bad)} must be refused`);
    if (!rejected.ok) assert.match(rejected.error, /scoring_budget/);
  }
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

// --- Strength (mandatory / preferred / acceptable) -------------------------------

test('a profile without strengths keeps every field mandatory, as before', () => {
  const profile = parsed();
  const spec = compileProfile(profile);
  assert.deepEqual(spec.hard.languages, ['it', 'en']);
  assert.deepEqual(spec.hard.remote_modes, ['remote', 'hybrid']);
  assert.deepEqual(spec.hard.contract_types, ['freelance']);
  assert.deepEqual(spec.soft.languages, [], 'nothing is soft unless the user says so');
});

test('a preferred field moves out of the hard filter, but languages stay a hard filter whatever the setting', () => {
  const result = parseProfile({ ...raw, strengths: { languages: 'preferred', remote_modes: 'preferred' } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const spec = compileProfile(result.profile);
  assert.deepEqual(spec.hard.languages, ['it', 'en'], 'the search is only in the languages the user speaks');
  assert.deepEqual(spec.soft.languages, [], 'languages are never a ranking input');
  assert.deepEqual(spec.hard.remote_modes, [], 'a preferred work mode is not a filter');
  assert.deepEqual(spec.soft.remote_modes, ['remote', 'hybrid']);
});

test('an acceptable salary floor is neither a filter nor a ranking input', () => {
  const result = parseProfile({ ...raw, strengths: { min_salary: 'acceptable' } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const spec = compileProfile(result.profile);
  assert.equal(spec.hard.min_salary, null);
  assert.equal(spec.soft.min_salary?.amount, 600);
});

test('an unknown strength key or value is named in the error', () => {
  const badKey = parseProfile({ ...raw, strengths: { seniority: 'mandatory' } });
  assert.equal(badKey.ok, false);
  if (!badKey.ok) assert.match(badKey.error, /strengths/);

  const badValue = parseProfile({ ...raw, strengths: { languages: 'maybe' } });
  assert.equal(badValue.ok, false);
  if (!badValue.ok) assert.match(badValue.error, /strengths\.languages/);
});

test('exclusions stay hard whatever strengths say', () => {
  const result = parseProfile({ ...raw, strengths: { exclude_terms: 'preferred' } });
  assert.equal(result.ok, false, 'exclusions are not a strength-bearing field');
});

test('the prompt context states which conditions are soft', () => {
  const result = parseProfile({ ...raw, strengths: { languages: 'preferred' } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(compilePromptContext(result.profile), /Languages \(preferred\): it; en/);
});

// --- Language proficiency, eligibility and remote scope -------------------------------

test('language proficiency is graded, and an unwilling language is excluded from the spec', () => {
  const result = parseProfile({
    ...raw,
    language_proficiency: {
      en: { level: 'professional', usage: 'limited' },
      it: { level: 'native', usage: 'comfortable' },
      de: { level: 'basic', usage: 'unwilling' },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const spec = compileProfile(result.profile);
  assert.deepEqual(spec.hard.excluded_languages, ['de'], 'a language the user will not use is a hard exclusion');
  assert.equal(result.profile.language_proficiency['en']?.level, 'professional');
});

test('an unknown proficiency level or usage is named in the error', () => {
  const badLevel = parseProfile({ ...raw, language_proficiency: { en: { level: 'expert', usage: 'comfortable' } } });
  assert.equal(badLevel.ok, false);
  if (!badLevel.ok) assert.match(badLevel.error, /language_proficiency\.en\.level/);

  const badUsage = parseProfile({ ...raw, language_proficiency: { en: { level: 'fluent', usage: 'maybe' } } });
  assert.equal(badUsage.ok, false);
  if (!badUsage.ok) assert.match(badUsage.error, /language_proficiency\.en\.usage/);
});

test('employee and contractor eligibility are kept separate and default to unknown', () => {
  const result = parseProfile({
    ...raw,
    eligibility: { employee: ['IT'], contractor: ['IT', 'DE'], residence: 'IT' },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const spec = compileProfile(result.profile);
  assert.deepEqual(spec.hard.employee_countries, ['IT']);
  assert.deepEqual(spec.hard.contractor_countries, ['IT', 'DE']);

  const silent = parsed();
  assert.deepEqual(compileProfile(silent).hard.employee_countries, [], 'not stated means no filter');
});

test('remote scope is never assumed worldwide', () => {
  assert.equal(parsed().remote_scope, null, 'an unstated remote scope stays unstated');

  const scoped = parseProfile({ ...raw, remote_scope: 'residence', eligibility: { residence: 'IT' } });
  assert.equal(scoped.ok, true);
  if (scoped.ok) {
    const hard = compileProfile(scoped.profile).hard;
    assert.equal(hard.remote_scope, 'residence');
    assert.deepEqual(hard.remote_countries, ['IT'], 'residence scope allows the residence country only');
  }

  const bad = parseProfile({ ...raw, remote_scope: 'anywhere' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /remote_scope/);
});

// --- The judge receives a structured summary, never the raw CV ------------------------

test('the prompt context never carries the raw CV text', () => {
  const context = compilePromptContext(parsed());
  assert.doesNotMatch(context, /Twelve years building things/, 'the CV text stays on the device');
  assert.doesNotMatch(context, /CV:/, 'no raw CV section is sent');
});

test('the prompt context states each language with its level and usage', () => {
  const result = parseProfile({
    ...raw,
    language_proficiency: {
      en: { level: 'fluent', usage: 'comfortable' },
      it: { level: 'native', usage: 'comfortable' },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(compilePromptContext(result.profile), /en: fluent, comfortable/);
});

test('the primary language is optional, must be one the user speaks, and defaults to not stated', () => {
  const unset = parseProfile({ ...raw });
  assert.ok(unset.ok && unset.profile.primary_language === null);
  const set = parseProfile({ ...raw, primary_language: 'it' });
  assert.ok(set.ok && set.profile.primary_language === 'it');
  const notSpoken = parseProfile({ ...raw, primary_language: 'fr' });
  assert.ok(!notSpoken.ok && notSpoken.error.includes('primary_language'), 'a primary language must be one of the languages');
});
