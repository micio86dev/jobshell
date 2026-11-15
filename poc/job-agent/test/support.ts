// Shared fixtures for the bridge and MCP tests. Not a test file itself.
import type { FetchLike } from '../src/jev.ts';
import { DEFAULT_STRENGTHS, type UserProfile } from '../src/profile.ts';

export const posting = {
  source: 'linkedin',
  id: '4012345678',
  title: 'Senior Rust Engineer',
  url: 'https://www.linkedin.com/jobs/view/4012345678/',
  company: 'Acme',
  description: 'Remote, EU timezone',
};

export const JUDGEMENT = JSON.stringify({
  model: 'jev-latest',
  answers: {
    fit: {
      type: 'choice',
      choice: 'yes',
      confidence: 0.9,
      probabilities: { yes: 0.93, yes_with_gap: 0.02, gap_not_accepted: 0.03, no: 0.02 },
    },
    stack_stance: {
      type: 'choice',
      choice: 'not_specified',
      confidence: 0.8,
      probabilities: { not_specified: 0.8, required_specific: 0.2 },
    },
  },
  usage: { input_tokens: 140, output_tokens: 18 },
});

export const capture = (): { urls: string[]; fetchImpl: FetchLike } => {
  const urls: string[] = [];
  return {
    urls,
    fetchImpl: async (url) => {
      urls.push(url);
      return { status: 200, text: JUDGEMENT };
    },
  };
};

export const profile: UserProfile = {
  headline: 'Backend developer',
  capabilities: ['desktop app'],
  domains: [],
  seniority: 'senior',
  years_experience: 12,
  remote_modes: ['remote'],
  onsite_cities: [],
  countries: [],
  contract_types: ['freelance'],
  languages: ['en'],
  primary_language: 'en',
  min_salary: null,
  timezone_overlap_hours: null,
  exclude_companies: [],
  exclude_terms: [],
  accepted_gaps: ['learn Go'],
  cv: 'Rust and Python.',
  portfolio: null,
  threshold: 0.9,
  daily_cap: 2,
  scoring_budget: 120,
  strengths: DEFAULT_STRENGTHS,
  language_proficiency: {},
  eligibility: { employee: [], contractor: [], residence: null },
  remote_scope: null,
};

/** A judgment with a high fit that the quality question marks as a scheme. */
export const SCAM_JUDGEMENT = JSON.stringify({
  model: 'jev-latest',
  answers: {
    fit: { type: 'choice', choice: 'yes', confidence: 0.9, probabilities: { yes: 0.97, no: 0.03 } },
    stack_stance: { type: 'choice', choice: 'not_specified', confidence: 0.9, probabilities: { not_specified: 1 } },
    gap: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 1 } },
    quality: { type: 'choice', choice: 'scam', confidence: 0.9, probabilities: { genuine: 0.02, scam: 0.95, vague: 0.03 } },
  },
  usage: { input_tokens: 10, output_tokens: 1 },
});
