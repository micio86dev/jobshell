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

import { z } from 'zod';

export type RemoteMode = 'remote' | 'hybrid' | 'onsite';
export type ContractType = 'employee' | 'freelance';
export type Seniority = 'junior' | 'mid' | 'senior' | 'lead';
export type SalaryPeriod = 'year' | 'day' | 'hour';

export type SalaryFloor = { amount: number; currency: string; period: SalaryPeriod };

/**
 * How binding a preference is. `mandatory` filters postings out; `preferred` and
 * `acceptable` only feed ranking. A profile written before strengths existed has
 * every field mandatory, so its behaviour does not change.
 */
export type Strength = 'mandatory' | 'preferred' | 'acceptable';

/** The preferences that can be softened. Exclusions are never soft. */
export const STRENGTH_KEYS = [
  'languages',
  'remote_modes',
  'onsite_cities',
  'countries',
  'contract_types',
  'min_salary',
] as const;
export type StrengthKey = (typeof STRENGTH_KEYS)[number];
export type Strengths = Record<StrengthKey, Strength>;

/** Graded command of a language, from native to beginner. */

export const LANGUAGE_LEVELS = ['native', 'fluent', 'professional', 'intermediate', 'basic', 'beginner'] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

/**
 * Whether the user will work in a language: comfortably, with limits, or not at all.
 * `unwilling` is an exclusion; `limited` only ranks lower.
 */
export const LANGUAGE_USAGE = ['comfortable', 'limited', 'unwilling'] as const;
export type LanguageUsage = (typeof LANGUAGE_USAGE)[number];

export type LanguageProficiency = { level: LanguageLevel; usage: LanguageUsage };

/**
 * Where the user can work. Employee and contractor eligibility are separate, and an
 * empty list means "not stated": no filter is applied, never "everywhere".
 */
export type Eligibility = { employee: string[]; contractor: string[]; residence: string | null };

/** Remote work scope. Unstated (null) is never read as worldwide. */
export const REMOTE_SCOPES = ['worldwide', 'europe', 'countries', 'residence'] as const;
export type RemoteScope = (typeof REMOTE_SCOPES)[number];

/** Every preference mandatory: the behaviour of a profile written before strengths. */
export const DEFAULT_STRENGTHS: Strengths = {
  languages: 'mandatory',
  remote_modes: 'mandatory',
  onsite_cities: 'mandatory',
  countries: 'mandatory',
  contract_types: 'mandatory',
  min_salary: 'mandatory',
};

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
  /** The language the app navigates in. Must be one of `languages`; null means not stated. */
  primary_language: string | null;
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
  /** How many survivors one run is allowed to judge. A cost ceiling, not a quality one. */
  scoring_budget: number;
  /** Per-preference strength. Always complete: absent input means `mandatory`. */
  strengths: Strengths;
  /** Graded proficiency per ISO 639-1 code. Empty means "not stated". */
  language_proficiency: Record<string, LanguageProficiency>;
  eligibility: Eligibility;
  /** Null means not stated. It is never read as worldwide. */
  remote_scope: RemoteScope | null;
};

export type Spec = {
  /** Mandatory preferences only: these drop postings. A soft field is empty here. */
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
    /** Languages the user will not work in: a posting in one is dropped. */
    excluded_languages: string[];
    /** Empty means not stated, so no employee-eligibility filter applies. */
    employee_countries: string[];
    contractor_countries: string[];
    remote_scope: RemoteScope | null;
    /** Countries a remote posting must name, derived from the remote scope. */
    remote_countries: string[];
    /** The user's graded languages, used to check a posting's stated requirement. */
    language_proficiency: Record<string, LanguageProficiency>;
  };
  /** Preferred and acceptable preferences: they rank, they never drop. */
  soft: {
    languages: string[];
    remote_modes: RemoteMode[];
    onsite_cities: string[];
    countries: string[];
    contract_types: ContractType[];
    min_salary: SalaryFloor | null;
    /** Seniority is ranking only: a posting that states the same level ranks higher, nothing is dropped. */
    seniority: Seniority | null;
  };
  /** Search strings derived from capability and seniority, not from a stack list. */
  queries: string[];
  threshold: number;
  daily_cap: number;
  scoring_budget: number;
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
const STRENGTHS: readonly Strength[] = ['mandatory', 'preferred', 'acceptable'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clean = (values: string[]): string[] => values.map((value) => value.trim()).filter((value) => value.length > 0);
const notBlank = (value: string): boolean => value.trim().length > 0;
const nonNegativeFinite = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** A list of strings: absent is empty, a non-list or a non-string item fails with `message`. */
const textList = (message: string) =>
  z
    .array(z.string({ error: message }), { error: message })
    .optional()
    .transform((values) => clean(values ?? []));

const LANGUAGE_CODE = /^[a-z]{2}$/i;

const PROFILE_TYPE = 'the profile must be a JSON object';

/** The shape of a profile payload. Each message names its field, and is the one the tests pin. */
const profileShape = z.object(
  {
    headline: z
      .string({ error: 'headline must be a non-empty string' })
      .refine(notBlank, { error: 'headline must be a non-empty string' })
      .transform((value) => value.trim()),
    capabilities: textList('capabilities must be a non-empty array of strings').refine(
      (list) => list.length > 0,
      { error: 'capabilities must be a non-empty array of strings' },
    ),
    domains: textList('domains must be an array of strings'),
    seniority: z.enum(SENIORITIES, { error: `seniority must be one of ${SENIORITIES.join(', ')}` }),
    years_experience: z
      .number({ error: 'years_experience must be a non-negative number' })
      .refine(nonNegativeFinite, { error: 'years_experience must be a non-negative number' }),
    remote_modes: z
      .array(z.enum(REMOTE_MODES, { error: `remote_modes must contain only ${REMOTE_MODES.join(', ')}` }), {
        error: 'remote_modes must be an array of strings',
      })
      .optional()
      .transform((values) => values ?? []),
    onsite_cities: textList('onsite_cities must be an array of strings'),
    countries: textList('countries must be an array of strings'),
    contract_types: z
      .array(z.enum(CONTRACTS, { error: `contract_types must contain only ${CONTRACTS.join(', ')}` }), {
        error: 'contract_types must be a non-empty array of strings',
      })
      .refine((list) => list.length > 0, { error: 'contract_types must be a non-empty array of strings' }),
    languages: textList('languages must be an array of ISO 639-1 codes').refine(
      (list) => list.every((code) => LANGUAGE_CODE.test(code)),
      { error: 'languages must be an array of ISO 639-1 codes' },
    ),
    primary_language: z.string({ error: 'primary_language must be one of the languages the profile lists' }).nullish(),
    exclude_companies: textList('exclude_companies must be an array of strings'),
    exclude_terms: textList('exclude_terms must be an array of strings'),
    accepted_gaps: textList('accepted_gaps must be an array of strings'),
    cv: z
      .string({ error: 'cv must be a non-empty string' })
      .refine(notBlank, { error: 'cv must be a non-empty string' })
      .transform((value) => value.trim()),
    portfolio: z.string({ error: 'portfolio must be a string when present' }).nullish(),
    threshold: z
      .number({ error: 'threshold must be a number between 0 and 1' })
      .refine((value) => Number.isFinite(value) && value >= 0 && value <= 1, {
        error: 'threshold must be a number between 0 and 1',
      }),
    daily_cap: z
      .number({ error: 'daily_cap must be a positive integer' })
      .refine((value) => Number.isInteger(value) && value > 0, { error: 'daily_cap must be a positive integer' }),
    // Optional, so a profile written before this field existed still loads.
    scoring_budget: z
      .number({ error: 'scoring_budget must be a positive integer when present' })
      .refine((value) => Number.isInteger(value) && value > 0, {
        error: 'scoring_budget must be a positive integer when present',
      })
      .optional(),
    timezone_overlap_hours: z
      .number({ error: 'timezone_overlap_hours must be a non-negative number when present' })
      .refine(nonNegativeFinite, { error: 'timezone_overlap_hours must be a non-negative number when present' })
      .nullish(),
    min_salary: z
      .object(
        {
          amount: z
            .number({ error: 'min_salary.amount must be a non-negative number' })
            .refine(nonNegativeFinite, { error: 'min_salary.amount must be a non-negative number' }),
          currency: z
            .string({ error: 'min_salary.currency must be a three-letter code' })
            .refine((value) => value.trim().length === 3, { error: 'min_salary.currency must be a three-letter code' })
            .transform((value) => value.trim().toUpperCase()),
          period: z.enum(PERIODS, { error: `min_salary.period must be one of ${PERIODS.join(', ')}` }),
        },
        { error: 'min_salary must be an object when present' },
      )
      .nullish()
      .transform((value): SalaryFloor | null => value ?? null),
    // Each key and value is checked in superRefine below, so the message can name the key.
    strengths: z.record(z.string(), z.unknown(), { error: 'strengths must be an object when present' }).nullish(),
    language_proficiency: z
      .record(z.string(), z.unknown(), { error: 'language_proficiency must be an object when present' })
      .nullish(),
    eligibility: z
      .object(
        {
          employee: textList('eligibility.employee must be an array of country codes'),
          contractor: textList('eligibility.contractor must be an array of country codes'),
          residence: z.string({ error: 'eligibility.residence must be a country code when present' }).nullish(),
        },
        { error: 'eligibility must be an object when present' },
      )
      .nullish(),
    remote_scope: z
      .enum(REMOTE_SCOPES, { error: `remote_scope must be one of ${REMOTE_SCOPES.join(', ')}` })
      .nullish(),
  },
  { error: PROFILE_TYPE },
);

const LANGUAGE_PROFICIENCY_ENTRY = (code: string) =>
  z.object(
    {
      level: z.enum(LANGUAGE_LEVELS, {
        error: `language_proficiency.${code}.level must be one of ${LANGUAGE_LEVELS.join(', ')}`,
      }),
      usage: z.enum(LANGUAGE_USAGE, {
        error: `language_proficiency.${code}.usage must be one of ${LANGUAGE_USAGE.join(', ')}`,
      }),
    },
    { error: `language_proficiency.${code} must be an object` },
  );

const fail = (message: string): ProfileResult => ({ ok: false, error: `profile: ${message}` });

/** Validate a raw profile, naming the offending field. The first problem found is reported. */
export const parseProfile = (raw: unknown): ProfileResult => {
  const shaped = profileShape.safeParse(raw);
  if (!shaped.success) return fail(shaped.error.issues[0]?.message ?? PROFILE_TYPE);
  const data = shaped.data;
  const issues: string[] = [];

  const spoken = data.languages.map((code) => code.toLowerCase());
  if (data.primary_language !== undefined && data.primary_language !== null) {
    if (!spoken.includes(data.primary_language.toLowerCase())) {
      issues.push('primary_language must be one of the languages the profile lists');
    }
  }

  const strengths: Strengths = { ...DEFAULT_STRENGTHS };
  if (data.strengths !== undefined && data.strengths !== null) {
    for (const [key, value] of Object.entries(data.strengths)) {
      if (!STRENGTH_KEYS.includes(key as StrengthKey)) {
        issues.push(`strengths.${key} is not a softenable preference (use ${STRENGTH_KEYS.join(', ')})`);
        continue;
      }
      if (typeof value !== 'string' || !STRENGTHS.includes(value as Strength)) {
        issues.push(`strengths.${key} must be one of ${STRENGTHS.join(', ')}`);
        continue;
      }
      strengths[key as StrengthKey] = value as Strength;
    }
  }

  const proficiency: Record<string, LanguageProficiency> = {};
  if (data.language_proficiency !== undefined && data.language_proficiency !== null) {
    for (const [code, entry] of Object.entries(data.language_proficiency)) {
      const checked = LANGUAGE_PROFICIENCY_ENTRY(code).safeParse(entry);
      if (!checked.success) {
        issues.push(checked.error.issues[0]?.message ?? `language_proficiency.${code} must be an object`);
        continue;
      }
      if (!LANGUAGE_CODE.test(code.trim())) {
        issues.push(`language_proficiency.${code} must be keyed by an ISO 639-1 code`);
        continue;
      }
      proficiency[code.trim().toLowerCase()] = checked.data;
    }
  }

  if (issues.length > 0) return fail(issues[0] ?? PROFILE_TYPE);

  const eligibility: Eligibility =
    data.eligibility === undefined || data.eligibility === null
      ? { employee: [], contractor: [], residence: null }
      : {
          employee: data.eligibility.employee.map((code) => code.toUpperCase()),
          contractor: data.eligibility.contractor.map((code) => code.toUpperCase()),
          residence:
            typeof data.eligibility.residence === 'string' && notBlank(data.eligibility.residence)
              ? data.eligibility.residence.trim().toUpperCase()
              : null,
        };

  const portfolio = data.portfolio;
  const profile: UserProfile = {
    strengths,
    language_proficiency: proficiency,
    eligibility,
    remote_scope: data.remote_scope ?? null,
    headline: data.headline,
    capabilities: data.capabilities,
    domains: data.domains,
    seniority: data.seniority,
    years_experience: data.years_experience,
    remote_modes: data.remote_modes as RemoteMode[],
    onsite_cities: data.onsite_cities,
    countries: data.countries,
    contract_types: data.contract_types as ContractType[],
    languages: spoken,
    primary_language:
      data.primary_language === undefined || data.primary_language === null ? null : data.primary_language.toLowerCase(),
    min_salary: data.min_salary,
    timezone_overlap_hours: data.timezone_overlap_hours ?? null,
    exclude_companies: data.exclude_companies,
    exclude_terms: data.exclude_terms,
    accepted_gaps: data.accepted_gaps,
    cv: data.cv,
    portfolio: typeof portfolio === 'string' && notBlank(portfolio) ? portfolio.trim() : null,
    threshold: data.threshold,
    daily_cap: data.daily_cap,
    scoring_budget: data.scoring_budget ?? DEFAULT_SCORING_BUDGET,
  };
  return { ok: true, profile };
};

/** How many survivors one run may judge when the profile does not say. */
export const DEFAULT_SCORING_BUDGET = 120;

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

/**
 * The structured summary the scorer receives with every posting. It is built from the
 * user's reviewed fields only: the raw CV text and the portfolio link are never sent.
 */
export const compilePromptContext = (profile: UserProfile): string => {
  const salary = profile.min_salary === null
    ? 'not stated'
    : `${profile.min_salary.amount} ${profile.min_salary.currency}/${profile.min_salary.period}`;
  // A non-mandatory preference says so, so the scorer never reads it as a hard rule.
  const tag = (key: StrengthKey, name: string): string =>
    profile.strengths[key] === 'mandatory' ? name : `${name} (${profile.strengths[key]})`;
  // Each language with its level and usage, so the judge weighs a language by how well it is spoken.
  const codes = [...new Set([...profile.languages, ...Object.keys(profile.language_proficiency)])];
  const languageLine = codes.length === 0
    ? 'any'
    : codes
      .map((code) => {
        const entry = profile.language_proficiency[code];
        return entry === undefined ? code : `${code}: ${entry.level}, ${entry.usage}`;
      })
      .join('; ');
  return [
    `Headline: ${profile.headline}`,
    `Capabilities: ${profile.capabilities.join('; ')}`,
    `Domains: ${profile.domains.length > 0 ? profile.domains.join('; ') : 'not stated'}`,
    `Seniority: ${profile.seniority} (${profile.years_experience} years)`,
    `${tag('remote_modes', 'Working modes accepted')}: ${profile.remote_modes.length > 0 ? profile.remote_modes.join('; ') : 'any'}`,
    `${tag('countries', 'Countries accepted')}: ${profile.countries.length > 0 ? profile.countries.join('; ') : 'any'}`,
    `${tag('contract_types', 'Contract')}: ${profile.contract_types.join('; ')}`,
    `${tag('languages', 'Languages')}: ${languageLine}`,
    `${tag('min_salary', 'Minimum pay')}: ${salary}`,
    `Gaps accepted: ${profile.accepted_gaps.length > 0 ? profile.accepted_gaps.join('; ') : 'none declared'}`,
  ].join('\n');
};

/**
 * The countries a remote posting must name under the user's scope. `worldwide` and
 * `europe` yield no list: they are recorded but not enforced yet.
 */
const remoteCountriesFor = (profile: UserProfile): string[] => {
  switch (profile.remote_scope) {
    case 'residence':
      return profile.eligibility.residence === null ? [] : [profile.eligibility.residence];
    case 'countries':
      return profile.countries.map((code) => code.toUpperCase());
    default:
      return [];
  }
};

/** Compile the profile into the spec the daily funnel runs on. */
export const compileProfile = (
  profile: UserProfile,
  options: { maxAgeDays?: number; queryLimit?: number } = {},
): Spec => {
  const s = profile.strengths;
  const isHard = (key: StrengthKey): boolean => s[key] === 'mandatory';
  const isSoft = (key: StrengthKey): boolean => s[key] !== 'mandatory';
  return {
    hard: {
      // The languages the user speaks are always a hard filter: the search is only in them.
      languages: profile.languages,
      remote_modes: isHard('remote_modes') ? profile.remote_modes : [],
      onsite_cities: isHard('onsite_cities') ? profile.onsite_cities : [],
      countries: isHard('countries') ? profile.countries : [],
      contract_types: isHard('contract_types') ? profile.contract_types : [],
      exclude_companies: profile.exclude_companies.map((value) => value.toLowerCase()),
      exclude_terms: profile.exclude_terms.map((value) => value.toLowerCase()),
      min_salary: isHard('min_salary') ? profile.min_salary : null,
      max_age_days: options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
      excluded_languages: Object.entries(profile.language_proficiency)
        .filter(([, entry]) => entry.usage === 'unwilling')
        .map(([code]) => code),
      employee_countries: profile.eligibility.employee,
      contractor_countries: profile.eligibility.contractor,
      remote_scope: profile.remote_scope,
      remote_countries: remoteCountriesFor(profile),
      language_proficiency: profile.language_proficiency,
    },
    soft: {
      // Languages are never a ranking input: a posting is in a language the user speaks, or it is not searched.
      languages: [],
      remote_modes: isSoft('remote_modes') ? profile.remote_modes : [],
      onsite_cities: isSoft('onsite_cities') ? profile.onsite_cities : [],
      countries: isSoft('countries') ? profile.countries : [],
      contract_types: isSoft('contract_types') ? profile.contract_types : [],
      min_salary: isSoft('min_salary') ? profile.min_salary : null,
      seniority: profile.seniority,
    },
    queries: compileQueries(profile, options.queryLimit ?? 8),
    threshold: profile.threshold,
    daily_cap: profile.daily_cap,
    scoring_budget: profile.scoring_budget,
    prompt_context: compilePromptContext(profile),
  };
};
