import { describe, expect, it } from 'vitest';

import { countryName, suggestCountries } from './countries';

describe('suggestCountries', () => {
  it('an empty query offers the priority countries for IT and tech work first', () => {
    expect(suggestCountries('', 'en', [], 3)).toEqual(['IT', 'DE', 'GB']);
  });

  it('never offers a country already chosen, whatever the case of its code', () => {
    expect(suggestCountries('', 'en', ['it', 'DE'], 3)).toEqual(['GB', 'NL', 'ES']);
  });

  it('an exact code or name is the first suggestion', () => {
    expect(suggestCountries('de', 'en', [])[0]).toBe('DE');
    expect(suggestCountries('Germany', 'en', [])[0]).toBe('DE');
  });

  it('a name that starts with the query ranks before one that only contains it', () => {
    const results = suggestCountries('ire', 'en', []);
    expect(results).toContain('IE');
    expect(suggestCountries('ital', 'en', [])[0]).toBe('IT');
  });

  it('returns nothing for a query that matches no country, and respects the limit', () => {
    expect(suggestCountries('zzzz', 'en', [])).toEqual([]);
    expect(suggestCountries('', 'en', [], 2)).toHaveLength(2);
  });
});

describe('countryName', () => {
  it('names a country in the locale, and falls back to the code when no name exists', () => {
    expect(countryName('IT', 'it')).toBe('Italia');
    expect(countryName('IT', 'en')).toBe('Italy');
    expect(countryName('XX', 'en')).toBe('XX');
  });
});
