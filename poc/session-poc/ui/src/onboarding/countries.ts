/**
 * Country suggestions for the eligibility fields. Countries that IT and tech employers hire in
 * come first: this ordering is a curated, indicative choice, not market data. The rest of the
 * list keeps the alphabetical order of the names shown to the user.
 */

/** Countries offered first for IT and tech work, in order of relevance. */
export const PRIORITY_COUNTRIES = ['IT', 'DE', 'GB', 'NL', 'ES', 'FR', 'IE', 'CH', 'SE', 'PL', 'PT', 'AT', 'BE', 'DK', 'FI', 'NO', 'RO', 'CZ', 'US', 'CA'] as const;

/** Other countries the user can search for. */
const OTHER_COUNTRIES = [
  'AE', 'AU', 'BG', 'BR', 'CL', 'CO', 'CY', 'EE', 'GR', 'HR', 'HU', 'IL', 'IN', 'IS', 'JP', 'LT', 'LU',
  'LV', 'MA', 'MT', 'MX', 'NZ', 'SG', 'SI', 'SK', 'TR', 'UA', 'ZA',
] as const;

const ALL_COUNTRIES: readonly string[] = [...PRIORITY_COUNTRIES, ...OTHER_COUNTRIES];

/** The display name of a country code in a locale; the code itself when the browser has no name. */
export const countryName = (code: string, locale: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/**
 * Suggestions for a typed query, excluding the countries already chosen. An empty query shows the
 * priority countries. A query matches a code or a name that starts with, or contains, the text.
 */
export const suggestCountries = (query: string, locale: string, chosen: readonly string[], limit = 8): string[] => {
  const text = query.trim().toLowerCase();
  const taken = chosen.map((code) => code.toUpperCase());
  const available = ALL_COUNTRIES.filter((code) => !taken.includes(code));
  if (text === '') return available.slice(0, limit);
  const scored = available
    .map((code) => {
      const name = countryName(code, locale).toLowerCase();
      const code2 = code.toLowerCase();
      if (code2 === text || name === text) return { code, rank: 0 };
      if (name.startsWith(text) || code2.startsWith(text)) return { code, rank: 1 };
      if (name.includes(text)) return { code, rank: 2 };
      return null;
    })
    .filter((item): item is { code: string; rank: number } => item !== null)
    .sort((a, b) => a.rank - b.rank || ALL_COUNTRIES.indexOf(a.code) - ALL_COUNTRIES.indexOf(b.code));
  return scored.slice(0, limit).map((item) => item.code);
};
