// Tests for the zod boundary: what the CV or portfolio proposal and a saved draft may look like
// before the wizard trusts them. A value that does not fit is refused, never coerced.
import { describe, expect, it } from 'vitest';

import { cvProposalSchema, draftSchema, primaryOf } from './schema';

const emptyFields = () => ({
  headline: null,
  capabilities: [],
  domains: [],
  seniority: null,
  years_experience: null,
  languages: [],
});

describe('proposal boundary', () => {
  it('accepts a model proposal with languages as codes and levels, and a fallback', () => {
    const proposal = {
      source: 'model',
      reason: null,
      fields: {
        ...emptyFields(),
        headline: 'Desktop engineer',
        seniority: 'senior',
        years_experience: 12,
        languages: [
          { code: 'en', level: 'fluent' },
          { code: 'it', level: null },
        ],
      },
    };
    expect(cvProposalSchema.safeParse(proposal).success).toBe(true);
    const fallback = { source: 'fallback', reason: 'provider answered 401', fields: emptyFields() };
    expect(cvProposalSchema.safeParse(fallback).success).toBe(true);
  });

  it('refuses a language name where a code is required, instead of guessing the code', () => {
    const bad = { source: 'model', reason: null, fields: { ...emptyFields(), languages: [{ code: 'English', level: 'fluent' }] } };
    expect(cvProposalSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses a seniority outside the four levels instead of guessing one', () => {
    const bad = { source: 'model', reason: null, fields: { ...emptyFields(), seniority: 'principal' } };
    expect(cvProposalSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses a proposal that is not an object', () => {
    expect(cvProposalSchema.safeParse('{"source":"model"}').success).toBe(false);
  });
});

describe('draft boundary', () => {
  it('accepts an empty draft: every field is optional until the user fills it', () => {
    expect(draftSchema.safeParse({}).success).toBe(true);
  });

  it('refuses a remote scope outside the agent vocabulary, and never defaults it to worldwide', () => {
    expect(draftSchema.safeParse({ location: { remote_scope: 'everywhere' } }).success).toBe(false);
    const unstated = draftSchema.parse({ location: {} });
    expect(unstated.location?.remote_scope ?? null).toBe(null);
  });

  it('refuses a language level the agent does not know, and a row without a code', () => {
    expect(
      draftSchema.safeParse({ languages: { items: [{ code: 'en', level: 'expert', usage: 'comfortable' }] } }).success,
    ).toBe(false);
    expect(draftSchema.safeParse({ languages: { items: [{ code: 'en', level: null, usage: null }] } }).success).toBe(true);
  });

  it('keeps the CV text as a string, and the primary language as a two-letter code', () => {
    expect(draftSchema.safeParse({ cv: 'Twelve years of Rust' }).success).toBe(true);
    expect(draftSchema.safeParse({ cv: 42 }).success).toBe(false);
    expect(draftSchema.safeParse({ languages: { primary: 'English', items: [] } }).success).toBe(false);
  });

  it('a country that is not a two-letter upper-case code is refused', () => {
    expect(draftSchema.safeParse({ location: { employee_countries: ['Italy'] } }).success).toBe(false);
    expect(draftSchema.safeParse({ location: { remote_countries: ['it'] } }).success).toBe(false);
  });
});

describe('primary language of a saved identity', () => {
  it('reads the primary language code, and null when the payload has none or is not JSON', () => {
    expect(primaryOf('{"primary_language":"it"}')).toBe('it');
    expect(primaryOf('{"primary_language":null}')).toBe(null);
    expect(primaryOf('not json')).toBe(null);
    expect(primaryOf('{"primary_language":"English"}')).toBe(null);
  });
});
