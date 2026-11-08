/**
 * The user profile and the deterministic spec it compiles to.
 *
 * The profile is asked once and is the only place a model is needed to understand
 * a person. Everything downstream — the daily funnel — reads the compiled spec,
 * which is plain data: no model call, no drift, and a diff you can review when the
 * user changes their mind.
 *
 * The profile describes **capability**, not a list of languages: what the person can
 * deliver, in which domains, with how much autonomy, and which gaps they accept.
 * Stack matters as a modality of the posting (see `jev.ts`), never as a gate.
 */

export type RemoteMode = 'remote' | 'hybrid' | 'onsite';
export type ContractType = 'employee' | 'freelance';
export type Seniority = 'junior' | 'mid' | 'senior' | 'lead';
export type SalaryPeriod = 'year' | 'day' | 'hour';

export type SalaryFloor = { amount: number; currency: string; period: SalaryPeriod };

export type UserProfile = {
  /** What the person calls themselves, in their own words. */
  headline: string;
  /** What they can deliver: "desktop app", "data pipeline", "frontend", "API". */
  capabilities: string[];
  /** Domains where they have context: "SaaS B2B", "fintech", "e-commerce". */
  domains: string[];
  seniority: Seniority;
  years_experience: number;
  /** Which working modes they accept. An empty list means no filter. */
  remote_modes: RemoteMode[];
  /** Cities reachable when `onsite` or `hybrid` is accepted. */
  onsite_cities: string[];
  /** Countries whose companies they accept. An empty list means no filter. */
  countries: string[];
  contract_types: ContractType[];
  /** ISO 639-1 codes they work in. An empty list means no filter. */
  languages: string[];
  min_salary: SalaryFloor | null;
  timezone_overlap_hours: number | null;
  exclude_companies: string[];
  exclude_terms: string[];
  /**
   * Gaps the person accepts to close, in their own words. This is the field that
   * lets a posting requiring an unknown language still score high — and the reason
   * the app never decides that for them.
   */
  accepted_gaps: string[];
  /** Free text of the CV, used only by the scorer, never as a filter. */
  cv: string;
  portfolio: string | null;
  threshold: number;
  daily_cap: number;
};

export type Spec = {
  hard: {
    languages: string[];
    remote_modes: RemoteMode[];
    onsite_cities: string[];
    countries: string[];
    contract_types: ContractType[];
    exclude_companies: string[];
    exclude_terms: string[];
    min_salary: SalaryFloor | null;
    /** A posting older than this is stale; null date is kept and flagged. */
    max_age_days: number;
  };
  /** Search strings derived from capability and seniority, not from a stack list. */
  queries: string[];
  threshold: number;
  daily_cap: number;
  /** Compact state handed to the scorer with every posting. */
  prompt_context: string;
};

export type ProfileResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; error: string };

const REMOTE_MODES: readonly RemoteMode[] = ['remote', 'hybrid', 'onsite'];
const CONTRACTS: readonly ContractType[] = ['employee', 'freelance'];
const SENIORITIES: readonly Seniority[] = ['junior', 'mid', 'senior', 'lead'];
const PERIODS: readonly SalaryPeriod[] = ['year', 'day', 'hour'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    if (item.trim().length > 0) out.push(item.trim());
  }
  return out;
};

const fail = (message: string): ProfileResult => ({ ok: false, error: `profile: ${message}` });

/** Validate a raw profile, naming the offending field. */
export const parseProfile = (raw: unknown): ProfileResult => {
  if (!isRecord(raw)) return fail('the profile must be a JSON object');

  const headline = raw['headline'];
  if (typeof headline !== 'string' || headline.trim().length === 0) {
    return fail('headline must be a non-empty string');
  }

  const capabilities = strings(raw['capabilities']);
  if (capabilities === null || capabilities.length === 0) {
    return fail('capabilities must be a non-empty array of strings');
  }

  const domains = strings(raw['domains']);
  if (domains === null) return fail('domains must be an array of strings');

  const seniority = raw['seniority'];
  if (typeof seniority !== 'string' || !SENIORITIES.includes(seniority as Seniority)) {
    return fail(`seniority must be one of ${SENIORITIES.join(', ')}`);
  }

  const years = raw['years_experience'];
  if (typeof years !== 'number' || !Number.isFinite(years) || years < 0) {
    return fail('years_experience must be a non-negative number');
  }

  const remoteModes = strings(raw['remote_modes']);
  if (remoteModes === null) return fail('remote_modes must be an array of strings');
  for (const mode of remoteModes) {
    if (!REMOTE_MODES.includes(mode as RemoteMode)) {
      return fail(`remote_modes must contain only ${REMOTE_MODES.join(', ')}`);
    }
  }

  const onsiteCities = strings(raw['onsite_cities']);
  if (onsiteCities === null) return fail('onsite_cities must be an array of strings');

  const countries = strings(raw['countries']);
  if (countries === null) return fail('countries must be an array of strings');

  const contracts = strings(raw['contract_types']);
  if (contracts === null || contracts.length === 0) {
    return fail('contract_types must be a non-empty array of strings');
  }
  for (const contract of contracts) {
    if (!CONTRACTS.includes(contract as ContractType)) {
      return fail(`contract_types must contain only ${CONTRACTS.join(', ')}`);
    }
  }

  const languages = strings(raw['languages']);
  if (languages === null) return fail('languages must be an array of ISO 639-1 codes');

  const excludeCompanies = strings(raw['exclude_companies']);
  if (excludeCompanies === null) return fail('exclude_companies must be an array of strings');

  const excludeTerms = strings(raw['exclude_terms']);
  if (excludeTerms === null) return fail('exclude_terms must be an array of strings');

  const acceptedGaps = strings(raw['accepted_gaps']);
  if (acceptedGaps === null) return fail('accepted_gaps must be an array of strings');

  const cv = raw['cv'];
  if (typeof cv !== 'string' || cv.trim().length === 0) {
    return fail('cv must be a non-empty string');
  }

  const portfolio = raw['portfolio'];
  if (portfolio !== undefined && portfolio !== null && typeof portfolio !== 'string') {
    return fail('portfolio must be a string when present');
  }

  const threshold = raw['threshold'];
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return fail('threshold must be a number between 0 and 1');
  }

  const dailyCap = raw['daily_cap'];
  if (typeof dailyCap !== 'number' || !Number.isInteger(dailyCap) || dailyCap <= 0) {
    return fail('daily_cap must be a positive integer');
  }

  const overlap = raw['timezone_overlap_hours'];
  if (overlap !== undefined && overlap !== null && (typeof overlap !== 'number' || overlap < 0)) {
    return fail('timezone_overlap_hours must be a non-negative number when present');
  }

  let minSalary: SalaryFloor | null = null;
  const rawSalary = raw['min_salary'];
  if (rawSalary !== undefined && rawSalary !== null) {
    if (!isRecord(rawSalary)) return fail('min_salary must be an object when present');
    const amount = rawSalary['amount'];
    const currency = rawSalary['currency'];
    const period = rawSalary['period'];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return fail('min_salary.amount must be a non-negative number');
    }
    if (typeof currency !== 'string' || currency.trim().length !== 3) {
      return fail('min_salary.currency must be a three-letter code');
    }
    if (typeof period !== 'string' || !PERIODS.includes(period as SalaryPeriod)) {
      return fail(`min_salary.period must be one of ${PERIODS.join(', ')}`);
    }
    minSalary = { amount, currency: currency.trim().toUpperCase(), period: period as SalaryPeriod };
  }

  const profile: UserProfile = {
    headline: headline.trim(),
    capabilities,
    domains,
    seniority: seniority as Seniority,
    years_experience: years,
    remote_modes: remoteModes as RemoteMode[],
    onsite_cities: onsiteCities,
    countries,
    contract_types: contracts as ContractType[],
    languages: languages.map((code) => code.toLowerCase()),
    min_salary: minSalary,
    timezone_overlap_hours: typeof overlap === 'number' ? overlap : null,
    exclude_companies: excludeCompanies,
    exclude_terms: excludeTerms,
    accepted_gaps: acceptedGaps,
    cv: cv.trim(),
    portfolio: typeof portfolio === 'string' && portfolio.trim().length > 0 ? portfolio.trim() : null,
    threshold,
    daily_cap: dailyCap,
  };
  return { ok: true, profile };
};

/** How many days a posting may be old before it is treated as stale. */
export const DEFAULT_MAX_AGE_DAYS = 14;

/** The queries the daily run searches with, derived from capability. */
export const compileQueries = (profile: UserProfile, limit = 8): string[] => {
  const queries: string[] = [];
  for (const capability of profile.capabilities) {
    queries.push(capability);
    queries.push(`${profile.seniority} ${capability}`);
  }
  for (const domain of profile.domains) queries.push(`${profile.seniority} ${domain}`);
  const unique: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    if (trimmed.length === 0) continue;
    if (!unique.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) unique.push(trimmed);
  }
  return unique.slice(0, limit);
};

/** A compact, human-readable state for the scorer. No secret, no PII beyond the CV. */
export const compilePromptContext = (profile: UserProfile): string => {
  const salary = profile.min_salary === null
    ? 'not stated'
    : `${profile.min_salary.amount} ${profile.min_salary.currency}/${profile.min_salary.period}`;
  return [
    `Headline: ${profile.headline}`,
    `Capabilities: ${profile.capabilities.join('; ')}`,
    `Domains: ${profile.domains.length > 0 ? profile.domains.join('; ') : 'not stated'}`,
    `Seniority: ${profile.seniority} (${profile.years_experience} years)`,
    `Working modes accepted: ${profile.remote_modes.length > 0 ? profile.remote_modes.join('; ') : 'any'}`,
    `Countries accepted: ${profile.countries.length > 0 ? profile.countries.join('; ') : 'any'}`,
    `Contract: ${profile.contract_types.join('; ')}`,
    `Languages: ${profile.languages.length > 0 ? profile.languages.join('; ') : 'any'}`,
    `Minimum pay: ${salary}`,
    `Gaps accepted: ${profile.accepted_gaps.length > 0 ? profile.accepted_gaps.join('; ') : 'none declared'}`,
    `CV: ${profile.cv}`,
    profile.portfolio === null ? null : `Portfolio: ${profile.portfolio}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

/** Compile the profile into the spec the daily funnel runs on. */
export const compileProfile = (
  profile: UserProfile,
  options: { maxAgeDays?: number; queryLimit?: number } = {},
): Spec => ({
  hard: {
    languages: profile.languages,
    remote_modes: profile.remote_modes,
    onsite_cities: profile.onsite_cities,
    countries: profile.countries,
    contract_types: profile.contract_types,
    exclude_companies: profile.exclude_companies.map((value) => value.toLowerCase()),
    exclude_terms: profile.exclude_terms.map((value) => value.toLowerCase()),
    min_salary: profile.min_salary,
    max_age_days: options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
  },
  queries: compileQueries(profile, options.queryLimit ?? 8),
  threshold: profile.threshold,
  daily_cap: profile.daily_cap,
  prompt_context: compilePromptContext(profile),
});
