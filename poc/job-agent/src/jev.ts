/**
 * TypeSafe System One client: the judgment layer.
 *
 * Two questions are asked per posting, and neither is a keyword test:
 *
 * 1. `stack_stance` — how the posting treats stack: an explicit requirement, a
 *    preference, not specified at all, or a tool it merely mentions. This is the
 *    signal that replaces a hard language filter (S13).
 * 2. `fit` — could this person do this job credibly, given what they can deliver
 *    and the gaps they declared they accept? The answer is a distribution, so the
 *    runner keeps P(yes) + P(yes_with_gap) and compares it to the user's threshold.
 *
 * Contract (docs.typesafe.ai, read 2026-11-08): `POST /v1/systemone`, `Authorization:
 * Bearer <key>`, body `{model, state, questions}`, response `{model, answers, usage}`.
 * Output tokens are currently free, so `usage.input_tokens` is the cost signal the
 * runner records.
 */
import type { Posting } from './sources/types.ts';

export const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_MODEL = 'jev-latest';

export type HttpResponse = { status: number; text: string };
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpResponse>;

export const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, text: await response.text() };
};

export type NoulQuestion = { type: 'noul'; instructions: string; criteria?: { true: string; false: string } };
export type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> };
export type JeQuestion = NoulQuestion | ChoiceQuestion;

export type Usage = { input_tokens: number; output_tokens: number };

export type JeAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };

export type JeResponse = { model: string; answers: Record<string, JeAnswer>; usage: Usage };

export type JeDeps = {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const parseAnswers = (raw: unknown): Record<string, JeAnswer> => {
  const answers: Record<string, JeAnswer> = {};
  if (!isRecord(raw)) return answers;
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    if (value['type'] === 'noul') {
      answers[name] = { type: 'noul', noul: number(value['noul']) };
      continue;
    }
    if (value['type'] === 'choice') {
      const probabilities: Record<string, number> = {};
      if (isRecord(value['probabilities'])) {
        for (const [choice, probability] of Object.entries(value['probabilities'])) {
          probabilities[choice] = number(probability);
        }
      }
      answers[name] = {
        type: 'choice',
        choice: typeof value['choice'] === 'string' ? value['choice'] : '',
        confidence: number(value['confidence']),
        probabilities,
      };
    }
  }
  return answers;
};

/**
 * Send one System One request.
 *
 * A failure throws a message with the status and nothing else: the key is never in
 * an error, a log line or an evidence file.
 */
export const askSystemOne = async (
  request: { state: unknown; questions: Record<string, JeQuestion> },
  deps: JeDeps,
): Promise<JeResponse> => {
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const url = deps.baseUrl ?? TYPESAFE_URL;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deps.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: deps.model ?? DEFAULT_MODEL,
      state: request.state,
      questions: request.questions,
    }),
  });

  if (response.status !== 200) {
    throw new Error(`typesafe: request failed with status ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new Error('typesafe: response was not JSON');
  }
  const record = isRecord(parsed) ? parsed : {};
  const usage = isRecord(record['usage']) ? record['usage'] : {};
  return {
    model: typeof record['model'] === 'string' ? record['model'] : (deps.model ?? DEFAULT_MODEL),
    answers: parseAnswers(record['answers']),
    usage: {
      input_tokens: number(usage['input_tokens']),
      output_tokens: number(usage['output_tokens']),
    },
  };
};

export type StackStance = 'required_specific' | 'preferred' | 'not_specified' | 'tool_mentioned';

/** Boundary validation: an unknown string from the API becomes the safe default. */
const STANCES: readonly StackStance[] = ['required_specific', 'preferred', 'not_specified', 'tool_mentioned'];
export const asStance = (value: string): StackStance => {
  for (const stance of STANCES) if (stance === value) return stance;
  return 'not_specified';
};

const STACK_CRITERIA: Record<string, string> = {
  required_specific:
    'The posting states one or more specific languages, frameworks or platforms as a requirement to be hired.',
  preferred: 'The posting mentions a specific stack as nice to have, or as one option among several.',
  not_specified:
    'The posting describes the role without naming any required language, framework or platform.',
  tool_mentioned:
    'The posting names a stack only as something the team uses or as something learnable, not as a hiring requirement.',
};

export type StanceResult = {
  stance: StackStance;
  probabilities: Record<string, number>;
  usage: Usage;
};

/** How the posting treats stack — the signal that replaces a hard filter. */
export const stackStance = async (posting: Posting, deps: JeDeps): Promise<StanceResult> => {
  const response = await askSystemOne(
    {
      state: { posting: postingState(posting) },
      questions: {
        stack_stance: {
          type: 'choice',
          instructions:
            'How does this job posting treat programming languages, frameworks and platforms: as a hiring requirement, as a preference, not at all, or only as a tool the team uses?',
          criteria: STACK_CRITERIA,
        },
      },
    },
    deps,
  );

  const answer = response.answers['stack_stance'];
  const probabilities = answer?.type === 'choice' ? answer.probabilities : {};
  return { stance: asStance(answer?.type === 'choice' ? answer.choice : ''), probabilities, usage: response.usage };
};

export type FitVerdict = 'yes' | 'yes_with_gap' | 'gap_not_accepted' | 'no';

const VERDICTS: readonly FitVerdict[] = ['yes', 'yes_with_gap', 'gap_not_accepted', 'no'];
export const asVerdict = (value: string): FitVerdict => {
  for (const verdict of VERDICTS) if (verdict === value) return verdict;
  return 'no';
};

const FIT_CRITERIA: Record<string, string> = {
  yes: 'A credible fit: this person could do this job today, and every stated requirement is one they can meet.',
  yes_with_gap:
    'A credible fit, but at least one stated requirement is missing from the profile and the profile declares that kind of gap as accepted.',
  gap_not_accepted:
    'At least one stated requirement is missing from the profile and the profile does not declare that gap as accepted.',
  no: 'Not a credible fit: a different discipline, a seniority far outside the profile, or a constraint the profile rejects.',
};

export type FitResult = {
  /** P(yes) + P(yes_with_gap): the number compared to the user's threshold. */
  probability: number;
  verdict: FitVerdict;
  probabilities: Record<string, number>;
  usage: Usage;
};

const postingState = (posting: Posting): Record<string, unknown> => ({
  source: posting.source,
  title: posting.title,
  company: posting.company,
  location: posting.location,
  remote: posting.remote_hint,
  salary: posting.salary,
  published_at: posting.published_at,
  description: posting.description === null ? null : posting.description.slice(0, 4000),
});

/** Would this person do this job credibly, and how likely is that? */
export const scoreFit = async (
  posting: Posting,
  promptContext: string,
  deps: JeDeps,
): Promise<FitResult> => {
  const response = await askSystemOne(
    {
      state: { posting: postingState(posting), candidate: promptContext },
      questions: {
        fit: {
          type: 'choice',
          instructions:
            'Given the candidate state and the posting, would this person do this job credibly? Weigh what they can deliver, their domains and seniority, the stack stance of the posting, and only the gaps the candidate declares as accepted.',
          criteria: FIT_CRITERIA,
        },
      },
    },
    deps,
  );

  const answer = response.answers['fit'];
  const probabilities = answer?.type === 'choice' ? answer.probabilities : {};
  const verdict = asVerdict(answer?.type === 'choice' ? answer.choice : '');
  const probability = Math.min(1, number(probabilities['yes']) + number(probabilities['yes_with_gap']));
  return { probability, verdict, probabilities, usage: response.usage };
};

/**
 * Both judgments in **one** request.
 *
 * System One answers several named questions about the same state, so asking the
 * stack stance and the fit together halves both the latency and the billed input
 * tokens compared with two round trips. This is the call the daily runner makes.
 */
export type JudgedPosting = {
  fit: { probability: number; verdict: FitVerdict; probabilities: Record<string, number> };
  stack_stance: { stance: StackStance; probabilities: Record<string, number> };
  usage: Usage;
};

export const judgePosting = async (
  posting: Posting,
  promptContext: string,
  deps: JeDeps,
): Promise<JudgedPosting> => {
  const response = await askSystemOne(
    {
      state: { posting: postingState(posting), candidate: promptContext },
      questions: {
        stack_stance: {
          type: 'choice',
          instructions:
            'How does this job posting treat programming languages, frameworks and platforms: as a hiring requirement, as a preference, not at all, or only as a tool the team uses?',
          criteria: STACK_CRITERIA,
        },
        fit: {
          type: 'choice',
          instructions:
            'Given the candidate state and the posting, would this person do this job credibly? Weigh what they can deliver, their domains and seniority, the stack stance of the posting, and only the gaps the candidate declares as accepted.',
          criteria: FIT_CRITERIA,
        },
      },
    },
    deps,
  );

  const fitAnswer = response.answers['fit'];
  const fitProbabilities = fitAnswer?.type === 'choice' ? fitAnswer.probabilities : {};
  const stanceAnswer = response.answers['stack_stance'];

  return {
    fit: {
      probability: Math.min(1, number(fitProbabilities['yes']) + number(fitProbabilities['yes_with_gap'])),
      verdict: asVerdict(fitAnswer?.type === 'choice' ? fitAnswer.choice : ''),
      probabilities: fitProbabilities,
    },
    stack_stance: {
      stance: asStance(stanceAnswer?.type === 'choice' ? stanceAnswer.choice : ''),
      probabilities: stanceAnswer?.type === 'choice' ? stanceAnswer.probabilities : {},
    },
    usage: response.usage,
  };
};
