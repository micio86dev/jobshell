/**
 * The tailored CV: the candidate's own CV rewritten for one posting. One model call, then a
 * deterministic guard: every number in the output must already appear in the CV or the posting.
 * A rewrite that adds a figure is refused, never shown.
 */
import { askModel } from './llm-call.ts';
import { MAX_CV_REPORT_CHARS, MAX_DESCRIPTION_CHARS, type ReportDeps, type ReportInput } from './report.ts';
import { isCliProvider, type CliProvider } from './llm-cli.ts';
import { LLM_LABEL, type LlmProvider } from './llm-providers.ts';

/** A complete CV is a long document: more room than a report needs. */
const TAILOR_MAX_TOKENS = 6_000;

export type TailorResult = { source: 'model'; markdown: string } | { source: 'fallback'; reason: string };

/** The instruction the model follows: rewrite for this posting, never add to the candidate. */
export const tailorInstruction = (input: ReportInput): string => {
  const description = (input.posting.description ?? '').slice(0, MAX_DESCRIPTION_CHARS);
  const cv = input.cv.slice(0, MAX_CV_REPORT_CHARS);
  return [
    'Build a complete professional CV for the posting below, as Markdown, in the CV language.',
    'Put the name and contact lines from the CV first. Use # for the name, ## for each section, - for list items.',
    'Keep the candidate own section headings and their same order, as the CV writes them.',
    'Include all the real experience of the CV, newest first, with its dates. Add the portfolio link when one is given.',
    '',
    'Rules:',
    '- Use only facts from the CV. You may reorder, select and reword them to match the posting.',
    '- Never invent experience, employers, dates, numbers, certifications, projects or skills.',
    '- A number is allowed only if it is already in the CV or the posting.',
    '- Leave out what the CV does not support for this posting; do not add it as a gap or a promise.',
    '- No dashes, arrows, check marks, emoji or decorative symbols: use commas, periods or colons.',
    '',
    `Position: ${input.posting.title}`,
    `Company: ${input.posting.company ?? 'not stated'}`,
    '',
    ...candidateBlock(input),
    '<cv>',
    cv,
    '</cv>',
    '',
    '<posting>',
    description,
    '</posting>',
  ].join('\n');
};

/** The wizard's facts as lines the model may use; an absent fact is simply not listed. */
const candidateBlock = (input: ReportInput): string[] => {
  const facts = input.candidate;
  if (facts === undefined) return [];
  const lines = [
    facts.headline === null ? null : `Title: ${facts.headline}`,
    facts.seniority === null ? null : `Seniority: ${facts.seniority}`,
    facts.years_experience === null ? null : `Years of experience: ${facts.years_experience}`,
    facts.capabilities.length === 0 ? null : `Skills: ${facts.capabilities.join(', ')}`,
    facts.languages.length === 0 ? null : `Languages: ${facts.languages.join(', ')}`,
    facts.portfolio === null ? null : `Portfolio: ${facts.portfolio}`,
  ].filter((line): line is string => line !== null);
  return ['<candidate>', ...lines, '</candidate>', ''];
};

/**
 * The text as a person would type it: an em dash becomes a comma, an en dash a hyphen, arrows
 * and decorative symbols go, curly quotes become straight ones. Accents and numbers stay.
 */
export const cleanForDocument = (text: string): string =>
  text
    .replace(/\s*—\s*/gu, ', ')
    .replace(/\s*(?:→|⇒|➜|➔|->)\s*/gu, ', ')
    .replace(/–/gu, '-')
    .replace(/[“”„]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[✓✔✗✘★☆•■▪◦]\s*/gu, '')
    .replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, '')
    .replace(/\s+,/gu, ',')
    .replace(/(,\s*){2,}/gu, ', ')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();

/** Digits in a text, with their decimal part, as they are written. */
const numbersIn = (text: string): string[] => text.match(/\d+(?:[.,]\d+)?/g) ?? [];

/** The first number in the output that neither the CV nor the posting contains, or null. */
const invented = (markdown: string, input: ReportInput): string | null => {
  const facts = [
    input.cv,
    input.posting.title,
    input.posting.description ?? '',
    input.posting.url,
    ...(input.candidate === undefined ? [] : Object.values(input.candidate).flat().map(String)),
  ];
  const known = new Set(numbersIn(facts.join(' ')));
  return numbersIn(markdown).find((number) => !known.has(number)) ?? null;
};

export const tailorCv = async (input: ReportInput, deps: ReportDeps): Promise<TailorResult> => {
  const provider: LlmProvider | CliProvider = deps.provider ?? 'anthropic';
  if (input.cv.trim().length === 0) return { source: 'fallback', reason: 'the CV is empty' };
  // A program the user signed in to needs no key from us.
  if (!isCliProvider(provider) && deps.apiKey.length === 0) return { source: 'fallback', reason: `no ${LLM_LABEL[provider]} key is stored` };

  const answer = await askModel(tailorInstruction(input), {
    apiKey: deps.apiKey,
    provider,
    model: deps.model,
    maxTokens: deps.maxTokens ?? TAILOR_MAX_TOKENS,
    baseUrl: deps.baseUrl,
    fetchImpl: deps.fetchImpl,
    ...(deps.cli === undefined ? {} : { cli: deps.cli }),
  });
  if (!answer.ok) return { source: 'fallback', reason: answer.reason };

  const markdown = cleanForDocument(answer.text);
  const figure = invented(markdown, input);
  if (figure !== null) {
    return { source: 'fallback', reason: `the tailored CV added the number ${figure}, which the CV does not contain: refused` };
  }
  return { source: 'model', markdown };
};
