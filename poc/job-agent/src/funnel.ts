/**
 * The daily funnel: the part that costs nothing.
 *
 * Everything here is a fact about the posting or about the user's own constraints,
 * so it is decided by code and can be explained in one line. Nothing semantic
 * happens here — stack, seniority and credibility are judgments and live in
 * `jev.ts`. That split is what keeps the daily loop free of model calls and keeps
 * every rejection auditable.
 */
import { LANGUAGE_LEVELS, type LanguageLevel, type Spec } from './profile.ts';
import type { Posting } from './sources/types.ts';

export type DropReason =
  | 'already_seen'
  | 'stale'
  | 'language'
  | 'remote_mode'
  | 'country'
  | 'onsite_city'
  | 'contract_type'
  | 'excluded_company'
  | 'excluded_term'
  | 'salary_below_floor'
  | 'eligibility'
  | 'remote_scope';

export type Dropped = { posting: Posting; reason: DropReason; detail: string };

/** A fact a hard constraint needed and the posting did not state. */
export type UnknownFact = 'date' | 'language' | 'remote' | 'country' | 'city' | 'contract';

/**
 * A posting that passed every filter while one or more facts were unknown. It is
 * kept, and the unknown facts are listed so verification can settle them. Unknown is
 * never read as satisfied.
 */
export type NeedsVerification = { posting: Posting; unknown: UnknownFact[] };

export type FunnelResult = {
  kept: Posting[];
  dropped: Dropped[];
  needs_verification: NeedsVerification[];
  /** Counts of postings kept without the fact the filter would have used. */
  unknown_date: number;
  unknown_language: number;
  unknown_remote: number;
  unknown_country: number;
  unknown_city: number;
  unknown_contract: number;
};

/** The identity of a posting across runs, used for "already shown". */
export const postingKey = (posting: Posting): string => `${posting.source}:${posting.id}`;

/**
 * Stopword-based language detection, deliberately dumb and offline.
 *
 * It is used only to drop a posting whose language the user does not work in, and
 * an unknown answer never drops anything: guessing wrong in that direction is the
 * silent false negative this product cannot afford.
 */
const STOPWORDS: Record<string, readonly string[]> = {
  it: ['il', 'lo', 'la', 'gli', 'di', 'che', 'per', 'con', 'una', 'sono', 'lavoro', 'esperienza', 'azienda'],
  en: ['the', 'and', 'for', 'with', 'you', 'we', 'are', 'our', 'will', 'experience', 'team', 'role'],
  de: ['und', 'der', 'die', 'das', 'mit', 'wir', 'für', 'sind', 'eine', 'erfahrung', 'aufgaben'],
  fr: ['et', 'les', 'des', 'une', 'pour', 'nous', 'vous', 'avec', 'est', 'dans', 'expérience', 'poste'],
  es: ['los', 'las', 'para', 'con', 'una', 'que', 'experiencia', 'empresa', 'buscamos', 'puesto'],
};

const MIN_MATCHES = 2;

/** Words a posting uses for a language, by ISO 639-1 code. */
const LANGUAGE_WORDS: Record<string, readonly string[]> = {
  en: ['english', 'inglese'],
  it: ['italian', 'italiano'],
  de: ['german', 'deutsch', 'tedesco'],
  fr: ['french', 'français', 'francese'],
  es: ['spanish', 'español', 'spagnolo'],
};

/** Words a posting uses for a level. CEFR codes map onto the same scale. */
const LEVEL_WORDS: Record<LanguageLevel, readonly string[]> = {
  native: ['native', 'madrelingua', 'mother tongue'],
  fluent: ['fluent', 'fluente'],
  professional: ['professional', 'professionale', 'business'],
  intermediate: ['intermediate', 'intermedio'],
  basic: ['basic'],
  beginner: ['beginner', 'principiante'],
};
const CEFR_LEVELS: Record<string, LanguageLevel> = {
  c2: 'fluent',
  c1: 'professional',
  b2: 'intermediate',
  b1: 'basic',
  a2: 'beginner',
  a1: 'beginner',
};

export type LanguageRequirement = { language: string; level: LanguageLevel | null };

/**
 * A language the posting states together with a level, read from the text near the
 * language name. A language with no stated level is not a requirement and returns null:
 * the posting's own language is judged by the ordinary language filter instead.
 */
export const detectLanguageRequirement = (text: string): LanguageRequirement | null => {
  const lower = text.toLowerCase();
  for (const [code, words] of Object.entries(LANGUAGE_WORDS)) {
    for (const word of words) {
      const at = lower.indexOf(word);
      if (at === -1) continue;
      const nearby = lower.slice(Math.max(0, at - 40), at + word.length + 40);
      for (const [level, levelWords] of Object.entries(LEVEL_WORDS) as Array<[LanguageLevel, readonly string[]]>) {
        if (levelWords.some((levelWord) => new RegExp(`\\b${levelWord}\\b`).test(nearby))) {
          return { language: code, level };
        }
      }
      const cefr = /\b(c[12]|b[12]|a[12])\b/.exec(nearby);
      if (cefr?.[1] !== undefined) return { language: code, level: CEFR_LEVELS[cefr[1]] ?? null };
    }
  }
  return null;
};

/** Lower index means a higher level: native is 0, beginner is the last. */
const levelRank = (level: LanguageLevel): number => LANGUAGE_LEVELS.indexOf(level);

export const detectLanguage = (text: string): string | null => {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length === 0) return null;
  const counts = new Map<string, number>();
  const wordSet = new Set(words);
  for (const [code, stopwords] of Object.entries(STOPWORDS)) {
    let hits = 0;
    for (const stopword of stopwords) if (wordSet.has(stopword)) hits += 1;
    counts.set(code, hits);
  }
  let best: string | null = null;
  let bestHits = 0;
  for (const [code, hits] of counts) {
    if (hits > bestHits) {
      best = code;
      bestHits = hits;
    }
  }
  return bestHits >= MIN_MATCHES ? best : null;
};

/**
 * Country names, so a profile constraint can be applied without guessing.
 *
 * Only a name we can read is a country: when the location names none of these, the
 * posting is kept and counted as unknown. Dropping on a guess is the silent false
 * negative this product cannot afford.
 */
const COUNTRY_NAMES: Record<string, readonly string[]> = {
  AT: ['austria', 'österreich'],
  BE: ['belgium', 'belgio', 'belgique'],
  BR: ['brasil', 'brazil'],
  CA: ['canada'],
  CH: ['switzerland', 'svizzera', 'schweiz'],
  DE: ['deutschland', 'germania', 'germany'],
  ES: ['españa', 'espana', 'spain'],
  FR: ['france', 'francia'],
  GB: ['united kingdom', 'england', 'regno unito'],
  IN: ['india'],
  IT: ['italia', 'italy'],
  NL: ['netherlands', 'paesi bassi', 'nederland'],
  PL: ['poland', 'polonia', 'polska'],
  PT: ['portugal', 'portogallo'],
  US: ['united states', 'usa'],
};

/**
 * The country a location names, or null when it names none we recognise.
 *
 * Matching is on whole words: `includes` would read "Indianapolis, Indiana" as India.
 */
export const detectCountry = (location: string): string | null => {
  const text = location.toLowerCase();
  for (const [code, names] of Object.entries(COUNTRY_NAMES)) {
    // `\b` is ASCII-only and misses "Österreich"; a letter lookaround is Unicode-aware.
    // Names are escaped first, so a future name with a regex metacharacter cannot break the match.
    const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (names.some((name) => new RegExp(`(?<!\\p{L})${escape(name)}(?!\\p{L})`, 'u').test(text))) return code;
  }
  return null;
};

const FREELANCE_MARKERS = /freelance|contractor|contract role|partita iva|p\.\s?iva|consulenz|\bb2b\b/;
const EMPLOYEE_MARKERS = /full[- ]time|permanent|dipendente|tempo indeterminato|contrato indefinido|\bcdi\b|unbefristet/;

/** The contract shape a posting states, or null when it states none. */
export const detectContract = (text: string): 'freelance' | 'employee' | null => {
  const freelance = FREELANCE_MARKERS.test(text.toLowerCase());
  const employee = EMPLOYEE_MARKERS.test(text.toLowerCase());
  if (freelance === employee) return null;
  return freelance ? 'freelance' : 'employee';
};

/** Approximate annualisation, documented so the comparison is not a hidden guess. */
const ANNUAL_FACTOR = { year: 1, day: 220, hour: 1760 } as const;

const annualise = (amount: number, period: 'year' | 'day' | 'hour'): number =>
  amount * ANNUAL_FACTOR[period];

/**
 * Read a published salary string into a number and a currency.
 *
 * Only the shapes these feeds actually publish: "90000-120000 USD", "$90k - $110k",
 * "600 EUR/day". Returns null when the text carries no number, and the caller then
 * keeps the posting: an unreadable salary is not a rejection.
 */
export const parseSalary = (raw: string): { amount: number; currency: string | null; period: 'year' | 'day' | 'hour' } | null => {
  const range = parseSalaryRange(raw);
  return range === null ? null : { amount: range.low, currency: range.currency, period: range.period };
};

/**
 * The bottom and top of a published salary. A range is compared by its top when
 * judging a floor: a posting that pays up to the floor is not a rejection.
 */
export const parseSalaryRange = (
  raw: string,
): { low: number; high: number; currency: string | null; period: 'year' | 'day' | 'hour' } | null => {
  const text = raw.toLowerCase();
  const numbers = [...text.matchAll(/(\d[\d.,]*)\s*(k)?/g)]
    .map((match) => {
      const digits = (match[1] ?? '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
      const value = Number.parseFloat(digits);
      if (!Number.isFinite(value)) return null;
      return match[2] === 'k' ? value * 1000 : value;
    })
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) return null;

  const currency =
    /(eur|usd|gbp|chf)/i.exec(text)?.[1]?.toUpperCase() ??
    (text.includes('€') ? 'EUR' : text.includes('£') ? 'GBP' : text.includes('$') ? 'USD' : null);
  const period = /(\/\s*(day|diem)|per day|day rate|tages?rate|giornalier)/i.test(text)
    ? 'day'
    : /(\/\s*h(our|r)|per hour|hourly|stunden)/i.test(text)
      ? 'hour'
      : 'year';

  return {
    low: Math.min(...numbers),
    high: Math.max(...numbers),
    currency,
    period,
  };
};

const ageInDays = (iso: string, now: Date): number | null => {
  const published = new Date(iso);
  if (Number.isNaN(published.getTime())) return null;
  return (now.getTime() - published.getTime()) / 86_400_000;
};

/** Drop what the user's own constraints reject, and explain every drop. */
export const applyHardFilters = (
  postings: Posting[],
  spec: Spec,
  seen: Set<string>,
  now: Date,
): FunnelResult => {
  const kept: Posting[] = [];
  const dropped: Dropped[] = [];
  // Counted only for postings that are kept: a dropped posting leaves no unknown behind.
  const unknownCounts: Record<UnknownFact, number> = {
    date: 0,
    language: 0,
    remote: 0,
    country: 0,
    city: 0,
    contract: 0,
  };
  const needsVerification: NeedsVerification[] = [];

  for (const posting of postings) {
    const unknownFacts: UnknownFact[] = [];
    if (seen.has(postingKey(posting))) {
      dropped.push({ posting, reason: 'already_seen', detail: 'shown in an earlier run' });
      continue;
    }

    if (posting.published_at === null) {
      unknownFacts.push('date');
    } else {
      const age = ageInDays(posting.published_at, now);
      if (age === null) {
        // An unreadable date is unknown, never fresh: count it and route it.
        unknownFacts.push('date');
      } else if (age > spec.hard.max_age_days) {
        dropped.push({
          posting,
          reason: 'stale',
          detail: `${Math.floor(age)} days old, limit ${spec.hard.max_age_days}`,
        });
        continue;
      }
    }

    if (spec.hard.languages.length > 0) {
      const haystack = `${posting.title} ${posting.description ?? ''}`;
      const language = detectLanguage(haystack);
      if (language === null) {
        // Only the languages the user speaks are searched, so a posting whose language cannot be read is not a match.
        dropped.push({ posting, reason: 'language', detail: 'language not readable' });
        continue;
      }
      if (!spec.hard.languages.includes(language)) {
        dropped.push({ posting, reason: 'language', detail: `detected ${language}` });
        continue;
      }
    }

    // A language the user will not work in excludes; a limited one only ranks lower.
    if (spec.hard.excluded_languages.length > 0) {
      const language = detectLanguage(`${posting.title} ${posting.description ?? ''}`);
      if (language !== null && spec.hard.excluded_languages.includes(language)) {
        dropped.push({ posting, reason: 'language', detail: `${language} is not a language the profile works in` });
        continue;
      }
    }

    // A stated language and level must be met by the user's own level for it, whatever the setting.
    const requirement = detectLanguageRequirement(`${posting.title} ${posting.description ?? ''}`);
    if (requirement !== null && requirement.level !== null) {
      const proficiency = spec.hard.language_proficiency[requirement.language];
      const met =
        proficiency !== undefined &&
        proficiency.usage !== 'unwilling' &&
        levelRank(proficiency.level) <= levelRank(requirement.level);
      if (!met) {
        dropped.push({
          posting,
          reason: 'language',
          detail: `requires ${requirement.level} ${requirement.language}`,
        });
        continue;
      }
    }

    const remoteOnly =
      spec.hard.remote_modes.length > 0 &&
      spec.hard.remote_modes.every((mode) => mode === 'remote');
    if (remoteOnly) {
      if (posting.remote_hint === null) {
        unknownFacts.push('remote');
      } else if (!posting.remote_hint) {
        dropped.push({ posting, reason: 'remote_mode', detail: 'the profile accepts remote only' });
        continue;
      }
    }

    const place = posting.location ?? '';

    if (spec.hard.countries.length > 0) {
      const detected = place.length === 0 ? null : detectCountry(place);
      if (detected === null) {
        unknownFacts.push('country');
      } else if (!spec.hard.countries.map((code) => code.toUpperCase()).includes(detected)) {
        dropped.push({ posting, reason: 'country', detail: `detected ${detected}` });
        continue;
      }
    }

    // Remote work is limited to the user's scope only when a scope is stated; an
    // unstated scope drops nothing, and an unknown place is kept.
    if (
      (spec.hard.remote_scope === 'residence' || spec.hard.remote_scope === 'countries') &&
      posting.remote_hint === true &&
      spec.hard.remote_countries.length > 0 &&
      place.length > 0
    ) {
      const country = detectCountry(place);
      if (country !== null && !spec.hard.remote_countries.includes(country)) {
        dropped.push({ posting, reason: 'remote_scope', detail: `remote work in ${country} is outside the scope` });
        continue;
      }
    }

    // A city constraint only means something for a posting the user would attend.
    const acceptsOnsite = spec.hard.remote_modes.some((mode) => mode !== 'remote');
    // A posting whose mode is unknown may be onsite: its city is unknown, not satisfied.
    if (acceptsOnsite && posting.remote_hint === null && spec.hard.onsite_cities.length > 0) {
      unknownFacts.push('city');
    }
    if (acceptsOnsite && posting.remote_hint === false && spec.hard.onsite_cities.length > 0) {
      const reachable = spec.hard.onsite_cities.some((city) => place.toLowerCase().includes(city.toLowerCase()));
      if (reachable) {
        // fine
      } else if (place.length === 0) {
        unknownFacts.push('city');
      } else {
        dropped.push({ posting, reason: 'onsite_city', detail: place });
        continue;
      }
    }

    // An empty list means "no preference", exactly as for countries and cities. Without
    // this guard `includes` is false for every detected contract and the filter drops
    // postings the user never asked to exclude.
    const contract = detectContract(`${posting.title} ${posting.description ?? ''}`);
    if (spec.hard.contract_types.length === 0) {
      // no constraint
    } else if (contract === null) {
      unknownFacts.push('contract');
    } else if (!spec.hard.contract_types.includes(contract)) {
      dropped.push({ posting, reason: 'contract_type', detail: contract });
      continue;
    }

    // Employee and contractor eligibility are separate. An empty list is not stated, and an
    // unknown contract shape or place is kept.
    if (contract !== null && place.length > 0) {
      const allowed = contract === 'employee' ? spec.hard.employee_countries : spec.hard.contractor_countries;
      const country = detectCountry(place);
      if (allowed.length > 0 && country !== null && !allowed.includes(country)) {
        dropped.push({ posting, reason: 'eligibility', detail: `${contract} work in ${country} is outside eligibility` });
        continue;
      }
    }

    const company = (posting.company ?? '').toLowerCase();
    const excludedCompany = spec.hard.exclude_companies.find((name) => company.includes(name));
    if (excludedCompany !== undefined) {
      dropped.push({ posting, reason: 'excluded_company', detail: excludedCompany });
      continue;
    }

    const haystack = `${posting.title} ${posting.description ?? ''}`.toLowerCase();
    const excludedTerm = spec.hard.exclude_terms.find((term) => haystack.includes(term));
    if (excludedTerm !== undefined) {
      dropped.push({ posting, reason: 'excluded_term', detail: excludedTerm });
      continue;
    }

    const floor = spec.hard.min_salary;
    if (floor !== null && posting.salary !== null) {
      const parsed = parseSalaryRange(posting.salary);
      // Compare only when the currency matches; a different currency is not a drop.
      if (parsed !== null && parsed.currency !== null && parsed.currency === floor.currency) {
        const postingTop = annualise(parsed.high, parsed.period);
        const floorAnnual = annualise(floor.amount, floor.period);
        if (postingTop < floorAnnual) {
          dropped.push({
            posting,
            reason: 'salary_below_floor',
            detail: `${parsed.high} ${parsed.currency}/${parsed.period} is below ${floor.amount} ${floor.currency}/${floor.period}`,
          });
          continue;
        }
      }
    }

    for (const fact of unknownFacts) unknownCounts[fact] += 1;
    if (unknownFacts.length > 0) needsVerification.push({ posting, unknown: unknownFacts });
    kept.push(posting);
  }

  return {
    kept,
    dropped,
    needs_verification: needsVerification,
    unknown_date: unknownCounts.date,
    unknown_language: unknownCounts.language,
    unknown_remote: unknownCounts.remote,
    unknown_country: unknownCounts.country,
    unknown_city: unknownCounts.city,
    unknown_contract: unknownCounts.contract,
  };
};

/** Points one satisfied soft preference adds, and the most the bonus can reach. */
export const SOFT_POINT = 0.05;
export const MAX_SOFT_BONUS = 0.1;

/**
 * How much a posting's soft preferences lift its ranking. A preference never drops a
 * posting, and an unknown fact never counts as a match.
 */
export const softBonus = (posting: Posting, soft: Spec['soft']): number => {
  let points = 0;
  const text = `${posting.title} ${posting.description ?? ''}`;

  if (soft.languages.length > 0) {
    const language = detectLanguage(text);
    if (language !== null && soft.languages.includes(language)) points += 1;
  }

  if (soft.remote_modes.length > 0 && posting.remote_hint !== null) {
    const matches = posting.remote_hint
      ? soft.remote_modes.includes('remote')
      : soft.remote_modes.some((mode) => mode !== 'remote');
    if (matches) points += 1;
  }

  if (soft.countries.length > 0) {
    const country = (posting.location ?? '').length === 0 ? null : detectCountry(posting.location ?? '');
    if (country !== null && soft.countries.map((code) => code.toUpperCase()).includes(country)) points += 1;
  }

  if (soft.contract_types.length > 0) {
    const contract = detectContract(text);
    if (contract !== null && soft.contract_types.includes(contract)) points += 1;
  }

  if (soft.min_salary !== null && posting.salary !== null) {
    const parsed = parseSalaryRange(posting.salary);
    if (parsed !== null && parsed.currency === soft.min_salary.currency) {
      const postingTop = annualise(parsed.high, parsed.period);
      if (postingTop >= annualise(soft.min_salary.amount, soft.min_salary.period)) points += 1;
    }
  }

  return Math.min(MAX_SOFT_BONUS, points * SOFT_POINT);
};

export type Scored = { posting: Posting; probability: number };

export type RankResult = {
  selected: Scored[];
  /** Above the threshold but beyond the daily cap: kept for the "almost" view. */
  overflow: Scored[];
  below_threshold: number;
};

/**
 * Keep what clears the threshold, best first, capped.
 *
 * A day with nothing above the threshold selects nothing: silence is the product,
 * not a bug, and `below_threshold` exists so the run can say how quiet it was.
 */
export const rankAndCap = (scored: Scored[], threshold: number, cap: number): RankResult => {
  const above = scored.filter((item) => item.probability >= threshold);
  const sorted = [...above].sort((a, b) => b.probability - a.probability);
  return {
    selected: sorted.slice(0, cap),
    overflow: sorted.slice(cap),
    below_threshold: scored.length - above.length,
  };
};
