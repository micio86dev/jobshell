// Tests for the zod boundary: what the CV proposal and a saved draft may look like before the
// wizard trusts them. A value that does not fit is refused, never coerced.
import { describe, expect, it } from 'vitest';

import { cvProposalSchema, draftSchema } from './schema';

describe('CV proposal boundary', () => {
  it('accepts a model proposal and a fallback', () => {
    const proposal = {
      source: 'model',
      reason: null,
      fields: {
        headline: 'Desktop engineer',
        capabilities: ['Rust'],
        domains: [],
        seniority: 'senior',
        years_experience: 12,
        languages: ['English'],
      },
    };
    expect(cvProposalSchema.safeParse(proposal).success).toBe(true);
    const fallback = { source: 'fallback', reason: 'provider answered 401', fields: emptyFields() };
    expect(cvProposalSchema.safeParse(fallback).success).toBe(true);
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
  it('accepts an empty draft: every field is optional until the wizard asks for it', () => {
    const parsed = draftSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it('refuses a remote scope outside the agent vocabulary, and never defaults it to worldwide', () => {
    const parsed = draftSchema.safeParse({ location: { remote_scope: 'everywhere' } });
    expect(parsed.success).toBe(false);
    const unstated = draftSchema.parse({ location: {} });
    expect(unstated.location?.remote_scope ?? null).toBe(null);
  });

  it('refuses a language level the agent does not know', () => {
    const parsed = draftSchema.safeParse({
      languages: { items: [{ code: 'en', level: 'expert', usage: 'comfortable' }] },
    });
    expect(parsed.success).toBe(false);
  });
});

const emptyFields = () => ({
  headline: null,
  capabilities: [],
  domains: [],
  seniority: null,
  years_experience: null,
  languages: [],
});
