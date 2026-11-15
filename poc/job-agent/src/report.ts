/**
 * The per-posting report: one model call that writes blocks A to G in Italian, from the CV
 * and the posting only.
 *
 * The key comes in as a value from the caller, never from a file here. Output is a Markdown
 * report or a fixed reason: never the key, never the CV, never a raw provider or network error.
 */
import { askModel } from './llm-call.ts';
import type { FetchLike } from './jev.ts';
import { LLM_LABEL, type LlmProvider } from './llm-providers.ts';

export const MAX_DESCRIPTION_CHARS = 20_000;
export const MAX_CV_REPORT_CHARS = 60_000;
export const DEFAULT_REPORT_MAX_TOKENS = 4_000;

export type ReportPosting = {
  title: string;
  company: string | null;
  url: string;
  description: string | null;
};

export type ReportInput = {
  posting: ReportPosting;
  cv: string;
  /** The fit verdict and gaps the run already produced, so the report starts from them. */
  verdict: string;
  gaps: string[];
  /** The wizard's facts, when the request carries them. */
  candidate?: Candidate;
};

export type ReportDeps = {
  apiKey: string;
  provider?: LlmProvider;
  model: string;
  maxTokens?: number;
  baseUrl?: string | undefined;
  fetchImpl: FetchLike;
};

/** The wizard's facts about the candidate. Each one is optional; a fact that is absent is never invented. */
export type Candidate = {
  headline: string | null;
  capabilities: string[];
  seniority: string | null;
  years_experience: number | null;
  languages: string[];
  portfolio: string | null;
};

export type ReportResult = { source: 'model'; markdown: string } | { source: 'fallback'; reason: string };

/** The instruction the model follows. Block headings are fixed so the UI can read them. */
export const reportInstruction = (input: ReportInput): string => {
  const description = (input.posting.description ?? '').slice(0, MAX_DESCRIPTION_CHARS);
  const cv = input.cv.slice(0, MAX_CV_REPORT_CHARS);
  const gaps = input.gaps.length > 0 ? input.gaps.join('; ') : 'none';
  return [
    'Write a job-fit report in Italian, in Markdown, with exactly these seven sections in this order:',
    '## A. Sintesi del ruolo',
    '## B. Match con il CV',
    '## C. Livello e strategia',
    '## D. Compensi',
    '## E. Piano di personalizzazione del CV',
    '## F. Domande probabili al colloquio',
    '## G. Note e verifiche',
    '',
    'Rules:',
    '- Use only facts from the CV and the posting. Quote the evidence for each claim in B.',
    '- Never invent experience, numbers, certifications, employers or projects.',
    '- A fact that is not stated: write "non dichiarato" (not stated). Do not guess it.',
    '- E suggests how to reword real CV content for this posting; it never adds experience the CV lacks.',
    '',
    `Position: ${input.posting.title}`,
    `Company: ${input.posting.company ?? 'not stated'}`,
    `Link: ${input.posting.url}`,
    `Earlier fit verdict: ${input.verdict}. Earlier gaps: ${gaps}.`,
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

/** Write the report with one model call. Every failure is a fixed reason. */
export const generateReport = async (input: ReportInput, deps: ReportDeps): Promise<ReportResult> => {
  const provider: LlmProvider = deps.provider ?? 'anthropic';
  if (input.cv.trim().length === 0) return { source: 'fallback', reason: 'the CV is empty' };
  if (deps.apiKey.length === 0) return { source: 'fallback', reason: `no ${LLM_LABEL[provider]} key is stored` };

  const answer = await askModel(reportInstruction(input), {
    apiKey: deps.apiKey,
    provider,
    model: deps.model,
    maxTokens: deps.maxTokens ?? DEFAULT_REPORT_MAX_TOKENS,
    baseUrl: deps.baseUrl,
    fetchImpl: deps.fetchImpl,
  });
  if (!answer.ok) return { source: 'fallback', reason: answer.reason };
  return { source: 'model', markdown: answer.text };
};

export type ReportRequestParse = { ok: true; input: ReportInput } | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Read one report request from JSON. Every refusal is a fixed reason, never the raw input. */
export const parseReportRequest = (raw: string): ReportRequestParse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'the report request is not valid JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'the report request must be an object' };
  const posting = parsed['posting'];
  if (!isRecord(posting)) return { ok: false, reason: 'posting is required' };
  if (!requiredText(posting['title'])) return { ok: false, reason: 'posting.title is required' };
  if (!requiredText(posting['url'])) return { ok: false, reason: 'posting.url is required' };
  const company = posting['company'];
  if (company !== null && typeof company !== 'string') return { ok: false, reason: 'posting.company must be text or null' };
  const description = posting['description'];
  if (description !== null && typeof description !== 'string') {
    return { ok: false, reason: 'posting.description must be text or null' };
  }
  if (typeof parsed['cv'] !== 'string') return { ok: false, reason: 'cv must be text' };
  if (typeof parsed['verdict'] !== 'string') return { ok: false, reason: 'verdict must be text' };
  const gaps = parsed['gaps'];
  if (!Array.isArray(gaps) || !gaps.every((gap) => typeof gap === 'string')) {
    return { ok: false, reason: 'gaps must be a list of strings' };
  }
  const candidate = parseCandidate(parsed['candidate']);
  if (!candidate.ok) return { ok: false, reason: candidate.reason };
  return {
    ok: true,
    input: {
      posting: {
        title: posting['title'],
        company,
        url: posting['url'],
        description,
      },
      cv: parsed['cv'],
      verdict: parsed['verdict'],
      gaps,
      ...(candidate.value === undefined ? {} : { candidate: candidate.value }),
    },
  };
};

const optionalText = (value: unknown): value is string | null | undefined => value === undefined || value === null || typeof value === 'string';
const textList = (value: unknown): value is string[] | undefined =>
  value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));

/** The candidate block is optional; a field with the wrong type refuses the request, never guesses. */
const parseCandidate = (
  raw: unknown,
): { ok: true; value: Candidate | undefined } | { ok: false; reason: string } => {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!isRecord(raw)) return { ok: false, reason: 'candidate must be an object' };
  if (!optionalText(raw['headline'])) return { ok: false, reason: 'candidate.headline must be text or null' };
  if (!optionalText(raw['seniority'])) return { ok: false, reason: 'candidate.seniority must be text or null' };
  if (!optionalText(raw['portfolio'])) return { ok: false, reason: 'candidate.portfolio must be text or null' };
  const years = raw['years_experience'];
  if (years !== undefined && years !== null && typeof years !== 'number') {
    return { ok: false, reason: 'candidate.years_experience must be a number or null' };
  }
  if (!textList(raw['capabilities'])) return { ok: false, reason: 'candidate.capabilities must be a list of text' };
  if (!textList(raw['languages'])) return { ok: false, reason: 'candidate.languages must be a list of text' };
  return {
    ok: true,
    value: {
      headline: raw['headline'] ?? null,
      capabilities: raw['capabilities'] ?? [],
      seniority: raw['seniority'] ?? null,
      years_experience: years ?? null,
      languages: raw['languages'] ?? [],
      portfolio: raw['portfolio'] ?? null,
    },
  };
};
