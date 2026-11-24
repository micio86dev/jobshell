/**
 * The free filter before the paid judgment.
 *
 * It removes only what is wrong whatever the profile says (unpaid, an internship, a junior role, a
 * closed or stale item, an on-site-only job, a company the user excluded) and ranks the rest by a
 * cheap score, so the judge sees the most promising signals first. Nothing here reads "no budget",
 * "no freelance wording" or "a different stack" as a reason to drop: those are for the judge.
 */
import { normalizeCompanyName } from './company.ts';
import { GENERIC_TECH, type LeadStrategy } from './strategy.ts';
import type { Signal, SignalType } from './types.ts';

export type Negative =
  | 'unpaid'
  | 'internship'
  | 'junior'
  | 'onsite_only'
  | 'closed'
  | 'stale'
  | 'excluded_company'
  | 'excluded_term';

const DAY_MS = 86_400_000;

const UNPAID = /\b(unpaid|volunteer(s|ing)?|no pay|without (pay|compensation)|equity[- ]only|volontariato|non retribuit\w*|sin remuneraci\w*)\b/i;
const INTERNSHIP = /\b(intern(ship)?|stagista|tirocinio|stage curricular|pr[aá]cticas|trainee|apprentice\w*|werkstudent|praktikum)\b/i;
const JUNIOR = /\b(junior|entry[- ]level|neolaureat\w*|graduate (developer|engineer)|jr\.)\b/i;
const ONSITE_ONLY = /\b(on-?site only|100% on-?site|no remote|not remote|in[- ]office (only|required)|presenza obbligatoria|solo in sede)\b/i;
const CLOSED = /\b(no longer accepting|position (has been )?filled|applications? (are )?closed|posizione chiusa|offerta scaduta|expired)\b/i;
const SENIOR = /\b(senior|lead|principal|staff|head of|cto|architect|sr\.)\b/i;

/** How much the kind of signal says about a need for outside engineers, before any judge reads it. */
const TYPE_WEIGHT: Record<SignalType, number> = {
  freelance_request: 1,
  manual_import: 0.9,
  community_post: 0.7,
  job_posting: 0.55,
  leadership_vacancy: 0.6,
  funding: 0.5,
  hiring_growth: 0.45,
  modernization: 0.55,
  product_launch: 0.4,
  expansion: 0.45,
  contract_win: 0.5,
};

const has = (haystack: string, term: string): boolean => {
  const escaped = term.replace(/[.+*?^$(){}|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}($|[^a-z0-9+#])`, 'i').test(haystack);
};

const textOf = (signal: Signal): string => `${signal.title}\n${signal.text ?? ''}`.toLowerCase();

/** Why a signal must not reach the judge. Empty means it may. */
export const negativesOf = (signal: Signal, strategy: LeadStrategy, now: Date): Negative[] => {
  const out: Negative[] = [];
  const all = textOf(signal);
  const head = `${signal.title}\n${(signal.text ?? '').slice(0, 300)}`;
  if (UNPAID.test(all)) out.push('unpaid');
  if (INTERNSHIP.test(head)) out.push('internship');
  if (JUNIOR.test(signal.title)) out.push('junior');
  if (ONSITE_ONLY.test(all) && signal.remote_hint !== true) out.push('onsite_only');
  if (CLOSED.test(all)) out.push('closed');

  // A pasted post is news to the user whatever its date says.
  if (signal.type !== 'manual_import' && signal.published_at !== null) {
    const limit = strategy.stale_days[signal.type] ?? 30;
    if (now.getTime() - new Date(signal.published_at).getTime() > limit * DAY_MS) out.push('stale');
  }
  const company = signal.company_name === null ? '' : normalizeCompanyName(signal.company_name);
  if (company !== '' && strategy.exclude_companies.some((excluded) => normalizeCompanyName(excluded) === company)) {
    out.push('excluded_company');
  }
  if (strategy.exclude_terms.some((term) => term.trim() !== '' && all.includes(term.toLowerCase()))) out.push('excluded_term');
  return out;
};

export type Ranked = { signal: Signal; pre_score: number; tech_hits: string[] };

/** The cheap score, between 0 and 1: kind of signal, technology named, freshness, and the level asked. */
export const preScore = (signal: Signal, strategy: LeadStrategy, now: Date): Ranked => {
  const all = textOf(signal);
  const techHits = strategy.tech_terms.filter((term) => has(all, term));
  const specific = Math.min(1, techHits.length / 3);
  const generic = Math.min(1, GENERIC_TECH.filter((term) => has(all, term)).length / 3);
  const tech = 0.6 * specific + 0.4 * generic;

  const limit = strategy.stale_days[signal.type] ?? 30;
  const age = signal.published_at === null ? null : (now.getTime() - new Date(signal.published_at).getTime()) / DAY_MS;
  const fresh = age === null ? 0.5 : Math.max(0, 1 - Math.max(0, age) / limit);

  const adjust = (signal.remote_hint === true ? 0.1 : signal.remote_hint === false ? -0.15 : 0) + (SENIOR.test(signal.title) ? 0.1 : 0);
  const score = 0.3 * TYPE_WEIGHT[signal.type] + 0.4 * tech + 0.2 * fresh + 0.1 * Math.max(0, Math.min(1, 0.5 + adjust));
  return { signal, pre_score: Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000, tech_hits: techHits };
};

/** Split the signals into the ones worth a judgment, best first, and the ones that are not, with the reason. */
export const prefilter = (
  signals: readonly Signal[],
  strategy: LeadStrategy,
  now: Date,
): { kept: Ranked[]; dropped: Array<{ signal: Signal; negatives: Negative[] }> } => {
  const kept: Ranked[] = [];
  const dropped: Array<{ signal: Signal; negatives: Negative[] }> = [];
  for (const signal of signals) {
    const negatives = negativesOf(signal, strategy, now);
    if (negatives.length > 0) dropped.push({ signal, negatives });
    else kept.push(preScore(signal, strategy, now));
  }
  // Array sort is stable: equal scores keep the order they were collected in.
  kept.sort((a, b) => b.pre_score - a.pre_score);
  return { kept, dropped };
};
