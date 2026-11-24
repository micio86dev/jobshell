/**
 * Search strings for the sources that take a query, generated from the profile.
 *
 * The base set is deterministic: the profile technologies and offerings, joined with the words that
 * signal an outside engagement, in the languages the user works in. A model may add a few more; what
 * it adds is bounded and cleaned, and if it fails the base set stands.
 */
import { askModel, type AskDeps } from '../llm-call.ts';
import type { UserProfile } from '../profile.ts';
import type { LeadStrategy } from './strategy.ts';

const ENGAGEMENT: Record<string, string[]> = {
  en: ['freelance', 'contractor', 'consultant', 'fractional CTO'],
  it: ['freelance', 'consulente', 'partita iva'],
  es: ['freelance', 'autónomo', 'consultor'],
};
const MAX_QUERIES = 20;
const MAX_LENGTH = 80;

export const baseQueries = (profile: UserProfile, strategy: LeadStrategy): string[] => {
  const languages = profile.languages.filter((code) => code in ENGAGEMENT);
  const codes = languages.length > 0 ? languages : ['en'];
  // The fixed buying-signal queries come first, so a long list of technologies never pushes them out.
  const queries = ['senior backend API architect remote B2B', 'technical partner startup MVP', 'fractional CTO', 'LLM integration engineer contract'];
  for (const term of strategy.tech_terms.slice(0, 3)) {
    queries.push(`${term} freelance`);
    for (const code of codes) for (const word of (ENGAGEMENT[code] ?? []).slice(1, 2)) queries.push(`${term} ${word}`);
    queries.push(`senior ${term} remote`);
  }
  return [...new Set(queries)].slice(0, MAX_QUERIES);
};

const listIn = (text: string): string[] => {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

/** The base queries, extended by the model when it is available. */
export const planLeadQueries = async (
  profile: UserProfile,
  strategy: LeadStrategy,
  deps: AskDeps | null,
): Promise<{ queries: string[]; source: 'model' | 'fallback'; reason: string | null }> => {
  const base = baseQueries(profile, strategy);
  if (deps === null) return { queries: base, source: 'fallback', reason: 'no model available' };
  const asked = await askModel(
    [
      'Write search queries that find companies likely to need an outside senior software engineer (a freelancer, contractor or consultant).',
      `The engineer offers: ${strategy.offerings.slice(0, 6).join('; ')}. Technologies: ${strategy.tech_terms.slice(0, 8).join(', ')}. Languages: ${profile.languages.join(', ')}.`,
      'Think of buying signals, not only job titles: a startup that just raised funding, a platform rebuild, a missing CTO, an agency short of capacity.',
      'Return ONLY a JSON array of up to 8 short queries (at most 8 words each), in the languages above.',
    ].join('\n'),
    { ...deps, maxTokens: 400 },
  );
  if (!asked.ok) return { queries: base, source: 'fallback', reason: asked.reason };
  const extra = listIn(asked.text)
    .map((query) => query.replace(/\s+/g, ' ').trim())
    .filter((query) => query.length >= 3 && query.length <= MAX_LENGTH);
  return { queries: [...new Set([...base, ...extra])].slice(0, MAX_QUERIES), source: extra.length > 0 ? 'model' : 'fallback', reason: extra.length > 0 ? null : 'the model gave no usable query' };
};
