/**
 * The score: a transparent 100 points, computed by code from the judge's probabilities and from facts
 * with a provenance. The judge never writes a score.
 *
 * | Dimension                                   | Points |
 * | technical and professional relevance        | 20     |
 * | B2B collaboration potential                 | 25     |
 * | commercial potential and company capacity   | 20     |
 * | long-term collaboration potential           | 15     |
 * | remote and international compatibility      | 10     |
 * | overall profile relevance                   | 10     |
 *
 * Three rules keep it honest. Unknown is neutral: a missing fact earns a middling share of its points
 * and lowers the confidence, it never rejects and never lifts. Only facts that carry evidence count;
 * the model's own reading earns nothing. Confidence and completeness are reported next to the score
 * and are never folded into it, because a high score on thin evidence is a different statement from
 * a high score on solid evidence.
 */
import type { Classification } from './classify.ts';
import type { LeadStrategy } from './strategy.ts';
import type { Contact, Fact, Signal } from './types.ts';

export const DIMENSIONS = [
  { name: 'technical_relevance', max: 20 },
  { name: 'b2b_potential', max: 25 },
  { name: 'company_capacity', max: 20 },
  { name: 'long_term_potential', max: 15 },
  { name: 'remote_international', max: 10 },
  { name: 'profile_relevance', max: 10 },
] as const;

export type Dimension = { name: string; points: number; max: number; explanation: string; evidence: string[] };

export type CaseInput = {
  primary: Signal;
  signals: readonly Signal[];
  classification: Classification;
  facts: readonly Fact[];
  contacts: readonly Contact[];
  /** What the research concluded, or null when none ran. */
  legitimacy: 'real' | 'doubtful' | 'unknown' | null;
  country: string | null;
  tech_hits: readonly string[];
  /** True when research ran and produced a usable answer. */
  researched: boolean;
  strategy: LeadStrategy;
  /** Why the signal was set aside before any judgment, if it was. */
  negatives?: readonly string[];
};

export type Scored = {
  total: number;
  confidence: number;
  completeness: number;
  dimensions: Dimension[];
  qualified: boolean;
  rejection_reason: string | null;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;
const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const pct = (value: number): string => `${Math.round(value * 100)}%`;
const p = (probabilities: Record<string, number>, key: string): number => probabilities[key] ?? 0;

/** An answer's probabilities weighed by a value per verdict; an answer with no probabilities counts its verdict alone. */
const expected = (
  answer: { verdict: string; probabilities: Record<string, number> },
  weights: Record<string, number>,
): number => {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [key]) => sum + p(answer.probabilities, key), 0);
  if (total <= 0) return weights[answer.verdict] ?? 0;
  return entries.reduce((sum, [key, weight]) => sum + (p(answer.probabilities, key) / total) * weight, 0);
};

const evidenceIds = (input: CaseInput): string[] => [input.primary.id];

/** Facts that carry evidence. The model's own reading is not one of them. */
const proven = (facts: readonly Fact[], field: string): Fact[] => facts.filter((fact) => fact.field === field && fact.provenance !== 'inferred');

export const scoreCase = (input: CaseInput): Scored => {
  const c = input.classification;
  const dims: Dimension[] = [];
  const add = (name: (typeof DIMENSIONS)[number]['name'], value: number, explanation: string): void => {
    const max = DIMENSIONS.find((dimension) => dimension.name === name)?.max ?? 0;
    dims.push({ name, points: round1(max * clamp(value)), max, explanation, evidence: evidenceIds(input) });
  };

  const fit = expected(c.fit, { strong: 1, transferable: 0.65, weak: 0.25, none: 0 });
  const level = expected(c.level, { matches: 1, beyond_profile: 0.2, junior_role: 0 });
  const techBonus = Math.min(0.1, 0.05 * input.tech_hits.length);
  add(
    'technical_relevance',
    fit * level + techBonus,
    `Fit ${c.fit.verdict} (${pct(fit)}), level ${c.level.verdict} (${pct(level)})${input.tech_hits.length > 0 ? `; names ${input.tech_hits.slice(0, 5).join(', ')}` : '; names none of the profile technologies'}.`,
  );

  const need = expected(c.need, { explicit_external: 1, probable_gap: 0.6, employee_only: 0.25, recruitment_marketing: 0, unrelated: 0 });
  add(
    'b2b_potential',
    0.5 * need + 0.5 * c.b2b,
    `Need: ${c.need.verdict} (${pct(need)}); could become a B2B engagement: ${pct(c.b2b)}${c.need.verdict === 'employee_only' ? ' (advertised as employment, not ruled out)' : ''}.`,
  );

  // Capacity: neutral without evidence, raised by each proven fact, capped by doubts about the business.
  const funding = proven(input.facts, 'funding').length > 0;
  const money = proven(input.facts, 'revenue').length + proven(input.facts, 'profitability').length > 0;
  const size = proven(input.facts, 'company_size').length > 0;
  const hiring = proven(input.facts, 'hiring').length + proven(input.facts, 'growth').length > 0;
  let capacity = 0.4 + (funding ? 0.3 : 0) + (money ? 0.2 : 0) + (size ? 0.1 : 0) + (hiring ? 0.15 : 0) + (input.legitimacy === 'real' ? 0.1 : 0);
  if (input.legitimacy === 'doubtful') capacity = Math.min(capacity, 0.2);
  const counted = [funding && 'funding', money && 'revenue or profit', size && 'size', hiring && 'hiring or growth', input.legitimacy === 'real' && 'a real business'].filter((part): part is string => part !== false);
  add(
    'company_capacity',
    capacity,
    counted.length > 0
      ? `Counted: ${counted.join(', ')}.`
      : 'No proven funding, revenue or size: counted as neutral, not as a weakness.',
  );

  const ongoing = funding || input.signals.some((signal) => signal.type === 'hiring_growth') || input.signals.length >= 2;
  add('long_term_potential', 0.6 * c.longterm + 0.4 * (ongoing ? 1 : 0.3), `Ongoing work: ${pct(c.longterm)}${ongoing ? '; the company is growing or shows several signals' : '; a single signal'}.`);

  const remote = expected(c.remote, { remote_ok: 1, unknown: 0.5, onsite_required: 0 });
  const market = input.country === null ? 0.7 : input.strategy.target_markets.includes(input.country) ? 1 : 0.6;
  add(
    'remote_international',
    0.7 * remote + 0.3 * market,
    `Remote: ${c.remote.verdict} (${pct(remote)}); country ${input.country ?? 'unknown'}${input.country !== null && input.strategy.target_markets.includes(input.country) ? ', a target market' : ''}.`,
  );

  add(
    'profile_relevance',
    0.5 * level + 0.3 * Math.min(1, input.tech_hits.length / 3) + 0.2 * (1 - p(c.need.probabilities, 'unrelated')),
    `Level ${pct(level)}, ${input.tech_hits.length} profile technologies named, work related to software: ${pct(1 - p(c.need.probabilities, 'unrelated'))}.`,
  );

  const total = round1(dims.reduce((sum, dimension) => sum + dimension.points, 0));

  // Confidence: how sure the judge was, and how solid the evidence is. Never part of the score.
  const certainty = [c.need, c.fit, c.level, c.remote].map((answer) => Math.max(0, ...Object.values(answer.probabilities)));
  const judge = certainty.reduce((sum, value) => sum + value, 0) / certainty.length;
  const nonInferred = input.facts.filter((fact) => fact.provenance !== 'inferred').length;
  const independent = new Set(input.signals.flatMap((signal) => signal.sources)).size >= 2;
  const evidenceQuality = clamp(0.3 + (input.researched ? 0.25 : 0) + Math.min(0.25, 0.05 * nonInferred) + (independent ? 0.1 : 0) + (input.legitimacy === 'real' ? 0.1 : 0));
  const confidence = round2(0.5 * judge + 0.5 * evidenceQuality);

  const known = [
    input.facts.some((fact) => fact.field === 'website') || input.legitimacy === 'real',
    input.country !== null,
    size,
    funding || money,
    hiring,
    input.contacts.length > 0,
    input.facts.some((fact) => fact.field === 'description'),
  ];
  const completeness = round2(known.filter(Boolean).length / known.length);

  const reasons: string[] = [];
  if ((input.negatives ?? []).length > 0) reasons.push(`set aside: ${(input.negatives ?? []).join(', ')}`);
  if (c.quality.suspicion >= 0.6) reasons.push('looks like a scheme or vague bait');
  if (p(c.need.probabilities, 'unrelated') >= 0.5 || c.need.verdict === 'unrelated') reasons.push('not about a company that needs software engineering');
  if (p(c.need.probabilities, 'recruitment_marketing') >= 0.5 || c.need.verdict === 'recruitment_marketing') reasons.push('recruitment marketing, not a client');
  if (input.legitimacy === 'doubtful') reasons.push('the business looks doubtful');
  if (total < input.strategy.threshold) reasons.push(`score ${total} is below ${input.strategy.threshold}`);
  if (confidence < input.strategy.min_confidence) reasons.push(`confidence ${confidence} is below ${input.strategy.min_confidence}`);

  return { total, confidence, completeness, dimensions: dims, qualified: reasons.length === 0, rejection_reason: reasons.length === 0 ? null : reasons.join('; ') };
};

/** Why the company may need outside engineers, in the words of the evidence. */
export const needSummary = (input: CaseInput, engineeringNeed: string): string => {
  const c = input.classification;
  const lead =
    c.need.verdict === 'explicit_external'
      ? 'Asks for outside engineers.'
      : c.need.verdict === 'probable_gap'
        ? 'Shows an engineering gap it may not be able to fill alone.'
        : 'Hires employees; it could be open to a contractor.';
  return [lead, engineeringNeed.trim(), `Evidence: ${input.primary.title.slice(0, 140)}`].filter((part) => part !== '').join(' ');
};

/** The next step, from what is actually known. */
export const nextAction = (input: CaseInput, website: string | null): string => {
  const person = input.contacts.find((contact) => contact.name !== null);
  if (person !== undefined) return `Write to ${person.name ?? ''} (${person.role}) through ${person.channel === 'email' ? person.value : person.source_url}.`;
  const channel = input.contacts[0];
  if (channel !== undefined) return `Use the public ${channel.role} contact: ${channel.channel === 'email' ? channel.value : channel.source_url}.`;
  if (input.primary.type === 'freelance_request' || input.primary.type === 'manual_import') return `Reply where it was posted: ${input.primary.url}`;
  if (website !== null) return `No public contact was found: use the contact page of ${website} and ask for the CTO or a founder.`;
  return 'No public contact was found: look for the CTO or a founder on the company site.';
};
