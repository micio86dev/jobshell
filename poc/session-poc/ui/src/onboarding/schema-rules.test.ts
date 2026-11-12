import { describe, expect, it } from 'vitest';
import { CONTRACT_TYPES, storedProfileSchema } from './schema';

describe('the saved profile follows the same rules as the draft', () => {
  it('refuses a residence that is not a two-letter upper-case country code', () => {
    const base = {
      cv: 'CV',
      headline: 'x',
      capabilities: [],
      seniority: 'senior' as const,
      years_experience: 3,
      remote_modes: [],
      onsite_cities: [],
      countries: [],
      contract_types: [],
      languages: ['en'],
      primary_language: 'en',
      strengths: {},
      language_proficiency: {},
      eligibility: { employee: [], contractor: [], residence: null as string | null },
      remote_scope: null,
    };
    expect(storedProfileSchema.safeParse({ ...base, eligibility: { ...base.eligibility, residence: 'italy' } }).success).toBe(false);
    expect(storedProfileSchema.safeParse(base).success).toBe(true);
    expect(storedProfileSchema.safeParse({ ...base, eligibility: { ...base.eligibility, residence: 'IT' } }).success).toBe(true);
  });

  it('the contract types of a proposal are the same list the rest of the wizard uses', () => {
    expect(CONTRACT_TYPES).toEqual(['employee', 'freelance']);
  });
});
