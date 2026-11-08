/**
 * The query planner: the one place a language model is used per run.
 *
 * It turns the compiled profile into search strings, and it is deliberately the
 * cheapest possible call: one short request, no postings in the prompt, and a
 * documented fallback when the model answers with something unparseable. The
 * evidence records which of the two produced the queries, because "the model
 * answered" and "we used the compiler" are different facts.
 */
import { compileQueries, type UserProfile } from './profile.ts';
import type { FetchLike } from './jev.ts';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const QWEN_URL =
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

export type PlannerDeps = {
  provider: 'anthropic' | 'qwen';
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl: FetchLike;
  maxQueries?: number;
};

export type PlanResult = {
  queries: string[];
  source: 'model' | 'fallback';
  /** Why the fallback was used, when it was. */
  reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `Array.isArray` on an unknown narrows to any[], which the standard forbids. */
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

const instruction = (context: string, maxQueries: number): string =>
  [
    'You write job-search queries for a candidate-side job agent.',
    'The candidate state is below. Return ONLY a JSON array of strings:',
    `${maxQueries} short search queries, in the candidate's working languages,`,
    'that would find postings this person could do.',
    'Do not include explanations, markdown or code fences.',
    '',
    context,
  ].join('\n');

/** Pull the first JSON array of strings out of a model answer. */
export const extractQueries = (text: string, limit: number): string[] | null => {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const queries: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed.length > 0 && !queries.includes(trimmed)) queries.push(trimmed);
  }
  return queries.length === 0 ? null : queries.slice(0, limit);
};

const usageFrom = (record: Record<string, unknown>): PlanResult['usage'] => {
  const usage = isRecord(record['usage']) ? record['usage'] : {};
  const input = typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
  const output = typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0;
  return { input_tokens: input, output_tokens: output };
};

/** Ask the configured provider for queries, falling back to the compiler. */
export const planQueries = async (profile: UserProfile, deps: PlannerDeps): Promise<PlanResult> => {
  const limit = deps.maxQueries ?? 8;
  const context = [
    `Headline: ${profile.headline}`,
    `Capabilities: ${profile.capabilities.join('; ')}`,
    `Domains: ${profile.domains.join('; ') || 'not stated'}`,
    `Seniority: ${profile.seniority}`,
    `Working modes: ${profile.remote_modes.join('; ') || 'any'}`,
    `Languages: ${profile.languages.join('; ') || 'any'}`,
  ].join('\n');

  const prompt = instruction(context, limit);

  const request = deps.provider === 'anthropic'
    ? {
        url: deps.baseUrl ?? ANTHROPIC_URL,
        init: {
          method: 'POST',
          headers: {
            'x-api-key': deps.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: deps.model,
            max_tokens: 400,
            messages: [{ role: 'user', content: prompt }],
          }),
        },
      }
    : {
        url: deps.baseUrl ?? QWEN_URL,
        init: {
          method: 'POST',
          headers: {
            authorization: `Bearer ${deps.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: deps.model,
            messages: [{ role: 'user', content: prompt }],
          }),
        },
      };

  const fallback = (reason: string): PlanResult => ({
    queries: compileQueries(profile, limit),
    source: 'fallback',
    reason,
    usage: { input_tokens: 0, output_tokens: 0 },
  });

  const response = await deps.fetchImpl(request.url, request.init);
  if (response.status !== 200) return fallback(`provider answered ${response.status}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return fallback('provider answer was not JSON');
  }
  const record = isRecord(parsed) ? parsed : {};
  const usage = usageFrom(record);

  const answerText = deps.provider === 'anthropic'
    ? asArray(record['content'])
        .map((block) => (isRecord(block) && typeof block['text'] === 'string' ? block['text'] : ''))
        .join('')
    : (() => {
        const first = asArray(record['choices'])[0];
        if (!isRecord(first) || !isRecord(first['message'])) return '';
        const content = first['message']['content'];
        return typeof content === 'string' ? content : '';
      })();

  const queries = extractQueries(answerText, limit);
  if (queries === null) return { ...fallback('provider answer had no usable query array'), usage };

  return { queries, source: 'model', reason: null, usage };
};
