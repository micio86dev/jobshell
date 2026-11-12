/**
 * The zod boundary of the onboarding wizard. Three things cross it: the CV or portfolio proposal
 * that comes back from the extractor, the wizard's own draft, and a saved identity read back for
 * editing. Each is parsed here before the UI trusts it. A value outside the agent's vocabulary is
 * refused, never coerced.
 *
 * The agent's validator stays the single authority for a saved profile; this schema guards the
 * wizard's inputs and outputs.
 */
import { z } from 'zod';

export const SENIORITIES = ['junior', 'mid', 'senior', 'lead'] as const;
export const STRENGTHS = ['mandatory', 'preferred', 'acceptable'] as const;
export const CONTRACT_TYPES = ['employee', 'freelance'] as const;
export const REMOTE_MODES = ['remote', 'hybrid', 'onsite'] as const;
export const REMOTE_SCOPES = ['worldwide', 'europe', 'countries', 'residence'] as const;
export const LANGUAGE_LEVELS = ['native', 'fluent', 'professional', 'intermediate', 'basic', 'beginner'] as const;
export const LANGUAGE_USAGE = ['comfortable', 'limited', 'unwilling'] as const;

export type Strength = (typeof STRENGTHS)[number];
export type ContractType = (typeof CONTRACT_TYPES)[number];
export type RemoteMode = (typeof REMOTE_MODES)[number];
export type RemoteScope = (typeof REMOTE_SCOPES)[number];
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];
export type LanguageUsage = (typeof LANGUAGE_USAGE)[number];
export type Seniority = (typeof SENIORITIES)[number];

const textList = z.array(z.string().trim().min(1).max(60));

/** ISO 3166 alpha-2 country codes, upper case: the only country form the agent reads. */
const countryList = z.array(z.string().regex(/^[A-Z]{2}$/));

/** ISO 639-1 language codes, lower case: the only language form the agent reads. */
const languageCode = z.string().regex(/^[a-z]{2}$/);

/** A language a document states: a code, and a level when the text states one. */
const proposedLanguage = z.object({
  code: languageCode,
  level: z.enum(LANGUAGE_LEVELS).nullable(),
});

/** What the extractor proposes from a CV or a portfolio. Every field is a proposal the user reviews. */
export const cvProposalSchema = z.object({
  source: z.enum(['model', 'fallback']),
  reason: z.string().nullable(),
  fields: z.object({
    headline: z.string().nullable(),
    capabilities: textList,
    domains: textList,
    seniority: z.enum(SENIORITIES).nullable(),
    years_experience: z.number().min(0).max(60).nullable(),
    languages: z.array(proposedLanguage),
  }),
});
export type CvProposal = z.infer<typeof cvProposalSchema>;

/**
 * The wizard's draft. Every field is optional until the user fills it: an absent value is "not
 * stated", never a default preference. A language row may lack its level or its usage until the
 * user chooses them; the finish rule refuses such a row.
 */
export const draftSchema = z.object({
  cv: z.string().max(60_000).optional(),
  portfolio: z.string().max(2048).optional(),
  headline: z.string().max(60).optional(),
  capabilities: textList.optional(),
  seniority: z.enum(SENIORITIES).nullable().optional(),
  years_experience: z.number().min(0).max(60).nullable().optional(),
  work: z
    .object({
      contract_types: z.array(z.enum(CONTRACT_TYPES)).optional(),
      strength: z.enum(STRENGTHS).optional(),
    })
    .optional(),
  location: z
    .object({
      remote_modes: z.array(z.enum(REMOTE_MODES)).optional(),
      strength: z.enum(STRENGTHS).optional(),
      remote_scope: z.enum(REMOTE_SCOPES).nullable().optional(),
      remote_countries: countryList.optional(),
      onsite_cities: textList.optional(),
      employee_countries: countryList.optional(),
      contractor_countries: countryList.optional(),
      residence: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
    })
    .optional(),
  languages: z
    .object({
      primary: languageCode.nullable().optional(),
      items: z
        .array(
          z.object({
            code: languageCode,
            level: z.enum(LANGUAGE_LEVELS).nullable(),
            usage: z.enum(LANGUAGE_USAGE).nullable(),
          }),
        )
        .optional(),
    })
    .optional(),
});
export type DraftInput = z.infer<typeof draftSchema>;

/**
 * A saved identity as the wizard reads it back for editing. The agent validated it when it was
 * saved; this shape check guards the fields the wizard reads. Unknown keys are ignored.
 */
export const storedProfileSchema = z.object({
  cv: z.string(),
  portfolio: z.string().max(2048).nullish(),
  headline: z.string(),
  capabilities: textList,
  seniority: z.enum(SENIORITIES),
  years_experience: z.number(),
  remote_modes: z.array(z.enum(REMOTE_MODES)),
  onsite_cities: textList,
  countries: countryList,
  contract_types: z.array(z.enum(CONTRACT_TYPES)),
  languages: z.array(languageCode),
  primary_language: languageCode.nullable(),
  strengths: z.record(z.string(), z.enum(STRENGTHS)),
  language_proficiency: z.record(
    languageCode,
    z.object({ level: z.enum(LANGUAGE_LEVELS), usage: z.enum(LANGUAGE_USAGE) }),
  ),
  eligibility: z.object({ employee: countryList, contractor: countryList, residence: z.string().nullable() }),
  remote_scope: z.enum(REMOTE_SCOPES).nullable(),
});
export type StoredProfile = z.infer<typeof storedProfileSchema>;

/** The primary language code of a saved identity payload, or null when it has none or cannot be read. */
export const primaryOf = (payload: string): string | null => {
  try {
    const parsed = z.object({ primary_language: languageCode.nullable() }).safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data.primary_language : null;
  } catch {
    return null;
  }
};
