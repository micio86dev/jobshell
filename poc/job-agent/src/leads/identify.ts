/**
 * Naming the company behind a signal that does not name it: a funding headline, a pasted post.
 *
 * One cheap request reads a batch of titles and returns, for each, the company the words are
 * about. The answer is accepted only when the company name and the quote are in the signal text
 * itself, so the model can point at a name but never supply one.
 */
import { z } from 'zod';
import { askModel, type AskDeps } from '../llm-call.ts';
import type { Signal } from './types.ts';

const BATCH = 12;
const MAX_NAME = 60;

const answerSchema = z.array(
  z.object({ id: z.string(), company: z.string().nullable(), quote: z.string().nullable() }),
);

const norm = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

const arrayIn = (text: string): unknown => {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

const promptFor = (batch: readonly Signal[]): string =>
  [
    'Each item below is a title and a short text from a news site, a forum post or a message.',
    'For each, name the one company the item is mainly about, exactly as the text writes it, or null when it names none or is about several.',
    'Return ONLY a JSON array: [{"id": string, "company": string|null, "quote": string|null}], where quote is the words of the text that name the company.',
    'Never use outside knowledge. If the text does not name the company, answer null.',
    '',
    ...batch.map((signal) => `id=${signal.id}\ntitle: ${signal.title}\ntext: ${(signal.text ?? '').slice(0, 400)}\n`),
  ].join('\n');

export type IdentifyResult = {
  signals: Signal[];
  identified: number;
  /** Set when a batch could not be asked: the signals stay unnamed and the reason is kept. */
  failure: string | null;
  usage: { input_tokens: number; output_tokens: number };
};

/** Give a company name to the signals that have none, when their own words name it. */
export const identifyCompanies = async (signals: readonly Signal[], deps: AskDeps): Promise<IdentifyResult> => {
  const result: Signal[] = signals.map((signal) => ({ ...signal }));
  const pending = result.filter((signal) => signal.company_name === null);
  const usage = { input_tokens: 0, output_tokens: 0 };
  let identified = 0;
  let failure: string | null = null;

  for (let index = 0; index < pending.length; index += BATCH) {
    const batch = pending.slice(index, index + BATCH);
    const asked = await askModel(promptFor(batch), { ...deps, maxTokens: 1500 });
    if (!asked.ok) {
      failure = asked.reason;
      break;
    }
    usage.input_tokens += asked.usage.input_tokens;
    usage.output_tokens += asked.usage.output_tokens;
    const parsed = answerSchema.safeParse(arrayIn(asked.text));
    if (!parsed.success) {
      failure = 'the answer did not match the expected shape';
      continue;
    }
    for (const entry of parsed.data) {
      const signal = batch.find((candidate) => candidate.id === entry.id);
      if (signal === undefined || entry.company === null || entry.quote === null) continue;
      const company = entry.company.trim();
      const words = norm(`${signal.title} ${signal.text ?? ''}`);
      // The name and the quote must both be in the signal itself.
      if (company.length < 2 || company.length > MAX_NAME || !words.includes(norm(company)) || !words.includes(norm(entry.quote))) continue;
      signal.company_name = company;
      identified += 1;
    }
  }
  return { signals: result, identified, failure, usage };
};
