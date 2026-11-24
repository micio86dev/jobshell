/**
 * The judgment of one signal, in one System One request.
 *
 * The questions are about the company's need, not about a job the candidate would apply to. A
 * regular vacancy is not a rejection here: whether it could become a contractor engagement is its
 * own question. The answers are probabilities, and the score is computed from them by code.
 */
import { z } from 'zod';
import { askSystemOne, type JeAnswer, type JeDeps, type JeQuestion, type Usage } from '../jev.ts';
import { compilePromptContext, type UserProfile } from '../profile.ts';
import type { LeadStrategy } from './strategy.ts';
import type { Signal } from './types.ts';

export const NEED_VALUES = ['explicit_external', 'probable_gap', 'employee_only', 'recruitment_marketing', 'unrelated'] as const;

/** Bumped whenever a question or an answer changes, so a verdict cached under the old wording is never reused. */
export const QUESTIONS_VERSION = 2;
export const FIT_VALUES = ['strong', 'transferable', 'weak', 'none'] as const;
export const LEVEL_VALUES = ['matches', 'junior_role', 'beyond_profile'] as const;
export const REMOTE_VALUES = ['remote_ok', 'onsite_required', 'unknown'] as const;
export const QUALITY_VALUES = ['genuine', 'scam', 'vague'] as const;

export type Need = (typeof NEED_VALUES)[number];
export type FitLevel = (typeof FIT_VALUES)[number];
export type Level = (typeof LEVEL_VALUES)[number];
export type RemoteFit = (typeof REMOTE_VALUES)[number];
export type Quality = (typeof QUALITY_VALUES)[number] | 'unknown';

export type Classification = {
  need: { verdict: Need; probabilities: Record<string, number> };
  /** P(this could become a B2B engagement for an independent senior engineer). */
  b2b: number;
  /** P(this is an ongoing product or platform, not a one-off fix). */
  longterm: number;
  fit: { verdict: FitLevel; probabilities: Record<string, number> };
  level: { verdict: Level; probabilities: Record<string, number> };
  remote: { verdict: RemoteFit; probabilities: Record<string, number> };
  quality: { verdict: Quality; suspicion: number };
  usage: Usage;
};

const QUESTIONS: Record<string, JeQuestion> = {
  need: {
    type: 'choice',
    instructions:
      'Does this evidence show that the company needs outside software engineering help (a contractor, freelancer, agency, consultant or fractional engineer), and not only that it hires employees? Judge the company need, not whether the candidate would like the job.',
    criteria: {
      explicit_external:
        'The text asks for a freelancer, contractor, consultant, agency or fractional engineer, or offers a project, a retainer or a B2B engagement.',
      probable_gap:
        'The text shows a software business with engineering work to do and no sign it can do it alone: open engineering roles, fresh funding for a product, a new product or platform, a rebuild or modernisation, or a vacancy for technical leadership.',
      employee_only:
        'An ordinary employee vacancy with no sign that outside engineers would be considered, and no sign of a capacity gap.',
      recruitment_marketing:
        'A recruiter, staffing firm or talent marketplace advertising to build its own pool or network of engineers, or to place them with unnamed clients, with no product or project of its own described. A software agency or consultancy that needs more capacity for named work is not this.',
      unrelated: 'The text is not about a company that needs software engineering work.',
    },
  },
  b2b: {
    type: 'noul',
    instructions:
      'Could this realistically become a B2B engagement, an independent senior engineer billing by project, retainer or effort, even if it is advertised as employment, an hourly contract or a vacancy?',
    criteria: {
      true: 'A senior engineer could plausibly be engaged as an independent contractor or consultant by this company.',
      false: 'Only an employee would be accepted: a fixed on-site role, a regulated hire, or no sign of openness to contractors.',
    },
  },
  longterm: {
    type: 'noul',
    instructions:
      'Is this likely to become a long-term collaboration: an ongoing product or platform with continuing engineering work, rather than a one-off fix?',
    criteria: {
      true: 'An ongoing product, platform or team that will keep needing engineering over months.',
      false: 'A one-off task, a short fixed job, or no sign of continuing work.',
    },
  },
  fit: {
    type: 'choice',
    instructions:
      'How well do the candidate offerings and technologies match the work described? Transferable senior engineering skill counts: a different language or framework is not by itself a mismatch, since the candidate learns new stacks quickly.',
    criteria: {
      strong: 'The work or the named stack is what the candidate offers.',
      transferable: 'A different stack or domain, but the same kind of senior engineering work, which the candidate could take on.',
      weak: 'Only a small part of the work relates to what the candidate offers.',
      none: 'A different discipline altogether.',
    },
  },
  level: {
    type: 'choice',
    instructions: 'Is the level of the work one that a senior engineer with the candidate experience can deliver?',
    criteria: {
      matches: 'Senior or mid-to-senior engineering work, or work without a stated level that a senior engineer can do.',
      junior_role: 'A junior, entry-level or trainee role.',
      beyond_profile: 'Requires deep specialist expertise the candidate does not have, such as research, embedded firmware or a regulated discipline.',
    },
  },
  remote: {
    type: 'choice',
    instructions: 'Can the work be done remotely by someone living in the candidate location, working in European time zones?',
    criteria: {
      remote_ok: 'Remote work is stated or clearly possible, with no restriction that excludes the candidate.',
      onsite_required: 'On-site presence is required, or the remote scope excludes the candidate location.',
      unknown: 'The text does not say.',
    },
  },
  quality: {
    type: 'choice',
    instructions:
      'Judging only the text: is this a genuine business signal worth the time of a candidate, or a scheme or vague bait? Answer from what the text says, not from the title alone.',
    criteria: {
      genuine: 'An identifiable company or project, with the work, the product or the news stated concretely.',
      scam: 'A scheme, not a company: crypto, trading or investment returns, referral or multi-level income, paying to start, "earn fast" promises, or someone asking for money or identity documents early.',
      vague: 'Too generic to be real: slogans, or a template text that could fit any company, with no concrete work or news described.',
    },
  },
};

const answerSchema = <T extends string>(values: readonly [T, ...T[]]) =>
  z.object({ verdict: z.enum(values), probabilities: z.record(z.string(), z.number()) });

/** The shape of a verdict read back from the cache: nothing from disk is trusted until it passes this. */
export const classificationSchema = z.object({
  need: answerSchema(NEED_VALUES),
  b2b: z.number(),
  longterm: z.number(),
  fit: answerSchema(FIT_VALUES),
  level: answerSchema(LEVEL_VALUES),
  remote: answerSchema(REMOTE_VALUES),
  quality: z.object({ verdict: z.enum([...QUALITY_VALUES, 'unknown']), suspicion: z.number() }),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/** Suspicion at or above this drops the signal, as for a job posting. */
export const SUSPICION_LIMIT = 0.6;

const probability = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** One choice answer: the allowed verdict (or the fallback) with its probabilities kept between 0 and 1. */
const choice = <T extends string>(answer: JeAnswer | undefined, allowed: readonly T[], fallback: T): { verdict: T; probabilities: Record<string, number> } => {
  if (answer?.type !== 'choice') return { verdict: fallback, probabilities: {} };
  const verdict = allowed.find((value) => value === answer.choice) ?? fallback;
  return {
    verdict,
    probabilities: Object.fromEntries(Object.entries(answer.probabilities).map(([key, value]) => [key, probability(value)])),
  };
};

const noul = (answer: JeAnswer | undefined): number => (answer?.type === 'noul' ? probability(answer.noul) : 0);

/** What the judge is told about the candidate: the reviewed profile fields and the offerings. */
export const candidateContext = (profile: UserProfile, strategy: LeadStrategy): string =>
  [
    compilePromptContext(profile),
    `Offerings: ${strategy.offerings.join('; ')}`,
    strategy.tech_terms.length > 0 ? `Technologies named in the profile: ${strategy.tech_terms.join(', ')}` : '',
    'Engagement sought: B2B collaboration as an independent senior engineer; remote, international.',
  ]
    .filter((line) => line !== '')
    .join('\n');

/** Ask the judge the seven questions about one signal, in one request. */
export const classifySignal = async (
  signal: Signal,
  context: string,
  deps: JeDeps,
): Promise<Classification> => {
  const response = await askSystemOne(
    {
      state: {
        signal: {
          kind: signal.type,
          source: signal.source,
          company: signal.company_name,
          title: signal.title,
          location: signal.location,
          remote: signal.remote_hint,
          salary: signal.salary,
          published_at: signal.published_at,
          text: signal.text === null ? null : signal.text.slice(0, 3500),
        },
        candidate: context,
      },
      questions: QUESTIONS,
    },
    deps,
  );
  const a = response.answers;
  const quality = choice(a['quality'], QUALITY_VALUES, 'genuine');
  return {
    need: choice(a['need'], NEED_VALUES, 'unrelated'),
    b2b: noul(a['b2b']),
    longterm: noul(a['longterm']),
    fit: choice(a['fit'], FIT_VALUES, 'none'),
    level: choice(a['level'], LEVEL_VALUES, 'matches'),
    remote: choice(a['remote'], REMOTE_VALUES, 'unknown'),
    // A missing quality answer is "not checked", never "genuine": the verdict says so.
    quality: {
      verdict: a['quality']?.type === 'choice' ? quality.verdict : 'unknown',
      suspicion: Math.min(1, (quality.probabilities['scam'] ?? 0) + (quality.probabilities['vague'] ?? 0)),
    },
    usage: response.usage,
  };
};

export const isSuspicious = (classification: Classification): boolean => classification.quality.suspicion >= SUSPICION_LIMIT;
