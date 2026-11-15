/**
 * The tailored CV: the candidate's own CV rewritten for one posting. One model call, then a
 * deterministic guard: every number in the output must already appear in the CV or the posting.
 * A rewrite that adds a figure is refused, never shown.
 */
import { askModel } from './llm-call.ts';
import { DEFAULT_REPORT_MAX_TOKENS, MAX_CV_REPORT_CHARS, MAX_DESCRIPTION_CHARS, type ReportDeps, type ReportInput } from './report.ts';
import { LLM_LABEL, type LlmProvider } from './llm-providers.ts';

export type TailorResult = { source: 'model'; markdown: string } | { source: 'fallback'; reason: string };

/** The instruction the model follows: rewrite for this posting, never add to the candidate. */
export const tailorInstruction = (input: ReportInput): string => {
  const description = (input.posting.description ?? '').slice(0, MAX_DESCRIPTION_CHARS);
  const cv = input.cv.slice(0, MAX_CV_REPORT_CHARS);
  return [
    'Rewrite the candidate CV below for the posting below, in Italian, as Markdown.',
    'Sections, in order: # Profilo, ## Competenze, ## Esperienza, ## Formazione, ## Lingue.',
    '',
    'Rules:',
    '- Use only facts from the CV. You may reorder, select and reword them to match the posting.',
    '- Never invent experience, employers, dates, numbers, certifications, projects or skills.',
    '- A number is allowed only if it is already in the CV or the posting.',
    '- Leave out what the CV does not support for this posting; do not add it as a gap or a promise.',
    '',
    `Position: ${input.posting.title}`,
    `Company: ${input.posting.company ?? 'not stated'}`,
    '',
    '<cv>',
    cv,
    '</cv>',
    '',
    '<posting>',
    description,
    '</posting>',
  ].join('\n');
};

/** Digits in a text, with their decimal part, as they are written. */
const numbersIn = (text: string): string[] => text.match(/\d+(?:[.,]\d+)?/g) ?? [];

/** The first number in the output that neither the CV nor the posting contains, or null. */
const invented = (markdown: string, input: ReportInput): string | null => {
  const known = new Set(numbersIn(`${input.cv} ${input.posting.title} ${input.posting.description ?? ''}`));
  return numbersIn(markdown).find((number) => !known.has(number)) ?? null;
};

export const tailorCv = async (input: ReportInput, deps: ReportDeps): Promise<TailorResult> => {
  const provider: LlmProvider = deps.provider ?? 'anthropic';
  if (input.cv.trim().length === 0) return { source: 'fallback', reason: 'the CV is empty' };
  if (deps.apiKey.length === 0) return { source: 'fallback', reason: `no ${LLM_LABEL[provider]} key is stored` };

  const answer = await askModel(tailorInstruction(input), {
    apiKey: deps.apiKey,
    provider,
    model: deps.model,
    maxTokens: deps.maxTokens ?? DEFAULT_REPORT_MAX_TOKENS,
    baseUrl: deps.baseUrl,
    fetchImpl: deps.fetchImpl,
  });
  if (!answer.ok) return { source: 'fallback', reason: answer.reason };

  const figure = invented(answer.text, input);
  if (figure !== null) {
    return { source: 'fallback', reason: `the tailored CV added the number ${figure}, which the CV does not contain: refused` };
  }
  return { source: 'model', markdown: answer.text };
};
