// The validator is the single source of truth for the profile schema. The Rust side
// stores payloads as opaque JSON and asks this module whether they are a valid profile.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateProfileText } from '../src/validate.ts';

const valid = JSON.stringify({
  headline: 'Backend developer',
  capabilities: ['API'],
  domains: [],
  seniority: 'senior',
  years_experience: 10,
  remote_modes: ['remote'],
  onsite_cities: [],
  countries: [],
  contract_types: ['freelance'],
  languages: ['en'],
  min_salary: null,
  exclude_companies: [],
  exclude_terms: [],
  accepted_gaps: [],
  cv: 'Ten years of APIs.',
  portfolio: null,
  threshold: 0.9,
  daily_cap: 2,
});

test('a valid profile is accepted', () => {
  assert.deepEqual(validateProfileText(valid), { ok: true });
});

test('an invalid profile names the field that failed', () => {
  const result = validateProfileText(valid.replace('"senior"', '"principal"'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /seniority/);
});

test('text that is not JSON is refused with a plain reason', () => {
  const result = validateProfileText('not json {');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not valid JSON/);
});

test('a JSON value that is not an object is refused', () => {
  const result = validateProfileText('[1,2,3]');
  assert.equal(result.ok, false);
});
