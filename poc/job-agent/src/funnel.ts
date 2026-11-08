/**
 * The daily funnel: the part that costs nothing.
 *
 * Everything here is a fact about the posting or about the user's own constraints,
 * so it is decided by code and can be explained in one line. Nothing semantic
 * happens here — stack, seniority and credibility are judgments and live in
 * `jev.ts`. That split is what keeps the daily loop free of model calls and keeps
 * every rejection auditable.
 */
import type { Spec } from './profile.ts';
import type { Posting } from './sources/types.ts';

export type DropReason =
  | 'already_seen'
  | 'stale'
  | 'language'
  | 'remote_mode'
  | 'excluded_company'
  | 'excluded_term'
  | 'salary_below_floor';

export type Dropped = { posting: Posting; reason: DropReason; detail: string };

export type FunnelResult = {
  kept: Posting[];
  dropped: Dropped[];
  /** Counts of postings kept without the fact the filter would have used. */
  unknown_date: number;
  unknown_language: number;
  unknown_remote: number;
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

  return { amount: numbers[0] ?? 0, currency, period };
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
  let unknownDate = 0;
  let unknownLanguage = 0;
  let unknownRemote = 0;

  for (const posting of postings) {
    if (seen.has(postingKey(posting))) {
      dropped.push({ posting, reason: 'already_seen', detail: 'shown in an earlier run' });
      continue;
    }

    if (posting.published_at === null) {
      unknownDate += 1;
    } else {
      const age = ageInDays(posting.published_at, now);
      if (age !== null && age > spec.hard.max_age_days) {
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
      if (language === null) unknownLanguage += 1;
      else if (!spec.hard.languages.includes(language)) {
        dropped.push({ posting, reason: 'language', detail: `detected ${language}` });
        continue;
      }
    }

    const remoteOnly =
      spec.hard.remote_modes.length > 0 &&
      spec.hard.remote_modes.every((mode) => mode === 'remote');
    if (remoteOnly) {
      if (posting.remote_hint === null) unknownRemote += 1;
      else if (!posting.remote_hint) {
        dropped.push({ posting, reason: 'remote_mode', detail: 'the profile accepts remote only' });
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
      const parsed = parseSalary(posting.salary);
      // Compare only when the currency matches; a different currency is not a drop.
      if (parsed !== null && parsed.currency !== null && parsed.currency === floor.currency) {
        const postingAnnual = annualise(parsed.amount, parsed.period);
        const floorAnnual = annualise(floor.amount, floor.period);
        if (postingAnnual < floorAnnual) {
          dropped.push({
            posting,
            reason: 'salary_below_floor',
            detail: `${parsed.amount} ${parsed.currency}/${parsed.period} is below ${floor.amount} ${floor.currency}/${floor.period}`,
          });
          continue;
        }
      }
    }

    kept.push(posting);
  }

  return {
    kept,
    dropped,
    unknown_date: unknownDate,
    unknown_language: unknownLanguage,
    unknown_remote: unknownRemote,
  };
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
