/**
 * The search strategy of the lead pipeline, as data the user can change without touching code.
 *
 * Defaults come from the profile, so a user who finished the wizard has a working strategy and
 * does not have to configure queries. A file overrides any field; a field that is not valid is an
 * error that names it, never a silent fallback.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';
import type { UserProfile } from '../profile.ts';
import type { SignalType } from './types.ts';

/** Technologies the CV or the capabilities may name. A term counts only when the profile says it. */
const TECH_TERMS = [
  'php', 'laravel', 'symfony', 'codeigniter', 'wordpress', 'prestashop', 'vue', 'nuxt', 'react', 'next', 'angular',
  'svelte', 'qwik', 'typescript', 'javascript', 'node', 'bun', 'deno', 'express', 'nestjs', 'python', 'django', 'fastapi',
  'flask', 'go', 'golang', 'rust', 'java', 'kotlin', 'swift', 'flutter', 'dart', 'ruby', 'rails', 'elixir', 'c#', '.net',
  'mysql', 'postgres', 'postgresql', 'mongodb', 'redis', 'sqlite', 'graphql', 'rest', 'api', 'docker', 'kubernetes',
  'aws', 'gcp', 'azure', 'terraform', 'tailwind', 'llm', 'openai', 'anthropic', 'claude', 'rag', 'agents', 'ionic', 'react native',
];

/** Words that make a text about software, whoever the company is. */
export const GENERIC_TECH = [
  'software', 'platform', 'saas', 'app', 'api', 'cloud', 'data', 'developer', 'engineer', 'engineering', 'backend',
  'frontend', 'full-stack', 'fullstack', 'devops', 'product', 'startup', 'ai', 'machine learning', 'llm', 'web',
];

const DAYS = z.number().int().min(1).max(730);

export const strategySchema = z.object({
  /** What the user sells, in their words. Shown to the judge and used in outreach. */
  offerings: z.array(z.string().min(1)).min(1),
  /** The technologies the profile names. A signal that names them is a stronger match. */
  tech_terms: z.array(z.string().min(1)),
  /** Countries, as ISO 3166 codes, in order of preference. Empty means no preference. */
  target_markets: z.array(z.string().length(2)),
  /** How old a signal may be, by kind, before it is no longer news. */
  stale_days: z.record(z.string(), DAYS),
  /** Score out of 100 a company must reach to be shown. */
  threshold: z.number().min(0).max(100),
  /** The least confidence in the evidence a lead needs to be shown. */
  min_confidence: z.number().min(0).max(1),
  /** The most signals judged, and the most companies researched, in one run. */
  classify_budget: z.number().int().min(0).max(1000),
  enrich_budget: z.number().int().min(0).max(100),
  /** A ceiling on the estimated cost of one run, in US dollars. */
  usd_cap: z.number().min(0).max(1000),
  /** Outreach languages, most preferred first. */
  outreach_languages: z.array(z.enum(['en', 'it', 'es'])).min(1),
  exclude_companies: z.array(z.string()),
  exclude_terms: z.array(z.string()),
});

export type LeadStrategy = z.infer<typeof strategySchema>;

export const DEFAULT_STALE_DAYS: Record<SignalType, number> = {
  job_posting: 30,
  freelance_request: 45,
  funding: 90,
  hiring_growth: 60,
  product_launch: 90,
  modernization: 90,
  leadership_vacancy: 45,
  contract_win: 90,
  expansion: 90,
  community_post: 30,
  manual_import: 365,
};

const present = (haystack: string, term: string): boolean =>
  new RegExp(`(^|[^a-z0-9+#.])${term.replace(/[.+*?^$(){}|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`, 'i').test(haystack);

/** Terms from the fixed technology list that the profile itself names. */
export const techTermsOf = (profile: UserProfile): string[] => {
  const haystack = [profile.headline, profile.capabilities.join(' '), profile.domains.join(' '), profile.cv].join(' ').toLowerCase();
  return TECH_TERMS.filter((term) => present(haystack, term));
};

/** The strategy a profile implies. Nothing here is a guess about the market: it restates the profile. */
export const defaultStrategy = (profile: UserProfile): LeadStrategy => ({
  offerings: profile.capabilities.length > 0 ? [...profile.capabilities] : [profile.headline],
  tech_terms: techTermsOf(profile),
  target_markets: ['DE', 'NL', 'CH', 'GB', 'US', 'IT'],
  stale_days: { ...DEFAULT_STALE_DAYS },
  threshold: 60,
  min_confidence: 0.4,
  classify_budget: 150,
  enrich_budget: 25,
  usd_cap: 5,
  outreach_languages: ['en', 'it', 'es'],
  exclude_companies: [...profile.exclude_companies],
  exclude_terms: [...profile.exclude_terms],
});

export const defaultStrategyPath = (): string => join(homedir(), '.config', 'jobshell', 'leads.json');

/** The profile's strategy with the user's file laid over it. A missing file is the defaults. */
export const loadStrategy = (
  profile: UserProfile,
  path: string = defaultStrategyPath(),
): { ok: true; strategy: LeadStrategy } | { ok: false; error: string } => {
  const base = defaultStrategy(profile);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    // No file is the defaults. A file that exists and cannot be read is said, never skipped.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, strategy: base };
    return { ok: false, error: 'leads strategy: the file cannot be read' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'leads strategy: the file is not valid JSON' };
  }
  const merged = { ...base, ...(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}) };
  const checked = strategySchema.safeParse({
    ...merged,
    stale_days: { ...base.stale_days, ...((merged as { stale_days?: Record<string, number> }).stale_days ?? {}) },
  });
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return { ok: false, error: `leads strategy: ${issue?.path.join('.') ?? 'file'} is invalid: ${issue?.message ?? 'unknown'}` };
  }
  return { ok: true, strategy: checked.data };
};
